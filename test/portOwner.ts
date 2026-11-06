/**
 * 端口占用者识别自检：验证 netstat / lsof / ss 解析，以及真实进程的识别与结束。
 *
 * 背景：端口被上次残留的 java 进程占住时，扩展要能告诉用户「是谁占的」并结束它。
 * 这里把三个平台的输出解析固化成可跑的验收点，再做一次端到端结束进程。
 * 仅用于验证，不参与扩展打包。
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  findPortOwners,
  killProcessTree,
  parseLsofListeners,
  parseNetstatListeners,
  parseSsListeners
} from '../src/util/portProcess';
import { isPortFree, waitPortFree } from '../src/util/ports';

const PORT = 18098;
const SERVER_SCRIPT = path.join(__dirname, '.tmp-port-owner.cjs');

let failed = 0;

function check(name: string, actual: string, expect: string, detail?: string): void {
  if (actual === expect) {
    console.log(`  PASS  ${name}`);
    return;
  }
  failed++;
  console.log(`  FAIL  ${name}`);
  console.log(`        期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}`);
  if (detail) {
    console.log(`        ${detail}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) {
      return true;
    }
    await sleep(200);
  }
  return false;
}

/** netstat -ano -p TCP 真实片段（中文 Windows 表头 + IPv4 / IPv6 / ESTABLISHED） */
const NETSTAT_SAMPLE = [
  '',
  '活动连接',
  '',
  '  协议  本地地址          外部地址        状态           PID',
  '  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       1234',
  '  TCP    127.0.0.1:8080         127.0.0.1:52344        ESTABLISHED     1234',
  '  TCP    [::]:8080              [::]:0                 LISTENING       1234',
  '  TCP    0.0.0.0:8081           0.0.0.0:0              LISTENING       5678',
  '  TCP    [::1]:18098            [::1]:51000            ESTABLISHED     9012',
  ''
].join('\r\n');

function checkParsers(): void {
  const on8080 = parseNetstatListeners(NETSTAT_SAMPLE, 8080);
  check(
    'netstat：只取 8080 的 LISTENING，IPv4/IPv6 去重',
    JSON.stringify(on8080.map((o) => o.pid)),
    JSON.stringify([1234])
  );

  const all = parseNetstatListeners(NETSTAT_SAMPLE);
  check(
    'netstat：不指定端口时列出全部 LISTENING（忽略 ESTABLISHED）',
    JSON.stringify(all.map((o) => o.pid)),
    JSON.stringify([1234, 5678])
  );

  const lsof = parseLsofListeners(['p1234', 'cjava', 'p5678', 'cnode', ''].join('\n'));
  check(
    'lsof：-Fpc 输出解析出 pid 与命令名',
    JSON.stringify(lsof.map((o) => `${o.pid}:${o.name}`)),
    JSON.stringify(['1234:java', '5678:node'])
  );

  const ss = parseSsListeners(
    [
      'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process',
      'LISTEN 0      128    0.0.0.0:8080        0.0.0.0:*          users:(("java",pid=1234,fd=103))',
      'LISTEN 0      128    [::]:8080           [::]:*             users:(("java",pid=1234,fd=104))',
      'LISTEN 0      128    0.0.0.0:9090        0.0.0.0:*          users:(("node",pid=5678,fd=20))',
      ''
    ].join('\n'),
    8080
  );
  check(
    'ss：解析 users 段里的 pid 与进程名，按端口过滤',
    JSON.stringify(ss.map((o) => `${o.pid}:${o.name}`)),
    JSON.stringify(['1234:java'])
  );

  const empty = parseNetstatListeners('', 8080);
  check('netstat：空输出不抛异常', JSON.stringify(empty), JSON.stringify([]));
}

function writeServerScript(): void {
  fs.writeFileSync(
    SERVER_SCRIPT,
    `require('http').createServer((req, res) => res.end('ok')).listen(${PORT});\n`,
    'utf8'
  );
}

async function checkEndToEnd(): Promise<void> {
  if (!(await isPortFree(PORT))) {
    check(`端口 ${PORT} 启动前可用`, '被占用', '空闲');
    return;
  }

  writeServerScript();
  // 直接 spawn node（不套 shell），这样 child.pid 就是真正监听端口的进程
  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: __dirname,
    windowsHide: true,
    stdio: 'ignore'
  });

  try {
    const listening = await waitFor(async () => !(await isPortFree(PORT)), 15000);
    check(`子进程在 ${PORT} 监听`, String(listening), 'true');
    if (!listening) {
      return;
    }

    const owners = await findPortOwners(PORT);
    const pids = owners.map((o) => o.pid);
    check(
      `findPortOwners(${PORT}) 能找到子进程 pid`,
      String(pids.includes(child.pid ?? -1)),
      'true',
      `识别到 ${JSON.stringify(pids)}，子进程 pid ${child.pid}`
    );

    const kill = await killProcessTree(child.pid ?? -1);
    check(`killProcessTree(${child.pid})`, String(kill.ok), 'true', kill.error);

    const freed = await waitPortFree(PORT, 15000);
    check(`结束进程后 ${PORT} 已释放`, String(freed), 'true');
  } finally {
    try {
      child.kill();
    } catch {
      // 进程可能已退出
    }
    try {
      fs.unlinkSync(SERVER_SCRIPT);
    } catch {
      // 文件可能已被清理
    }
  }
}

async function main(): Promise<void> {
  checkParsers();
  await checkEndToEnd();
  console.log('');
  console.log(failed === 0 ? '全部通过' : `失败 ${failed} 条`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
