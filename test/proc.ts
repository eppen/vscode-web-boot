/**
 * 进程管理自检：验证「shell 包装 + 进程树结束」能真正释放端口。
 *
 * 场景与真实启动一致：spawn 一个 shell，shell 再起子进程（这里是 node）。
 * 只 kill shell 会留下子进程占着端口，所以必须 taskkill /T（Windows）。
 * 仅用于验证，不参与扩展打包。
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnManaged } from '../src/runner/processManager';
import { isPortFree } from '../src/util/ports';

const PORT = 18099;
const SERVER_SCRIPT = path.join(__dirname, '.tmp-server.cjs');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) {
      return true;
    }
    await sleep(150);
  }
  return false;
}

async function main(): Promise<void> {
  fs.writeFileSync(
    SERVER_SCRIPT,
    `require('http').createServer((req, res) => res.end('ok')).listen(${PORT});\n`,
    'utf8'
  );

  if (!(await isPortFree(PORT))) {
    console.log(`  FAIL  端口 ${PORT} 启动前已被占用，无法验证`);
    process.exitCode = 1;
    return;
  }

  const lines: string[] = [];
  const proc = spawnManaged(`node "${SERVER_SCRIPT}"`, {
    cwd: __dirname,
    env: process.env,
    onLine: (line) => lines.push(line)
  });

  const listening = await waitFor(async () => !(await isPortFree(PORT)), 15000);
  if (!listening) {
    console.log(`  FAIL  子进程未能在 15s 内监听 ${PORT}`);
    console.log(`        输出：${lines.join(' | ') || '(空)'}`);
    await proc.stop();
    process.exitCode = 1;
    return;
  }
  console.log(`  PASS  子进程已在 ${PORT} 监听（shell pid ${proc.pid}）`);

  await proc.stop();

  const released = await waitFor(async () => isPortFree(PORT), 15000);
  if (!released) {
    console.log(`  FAIL  停止后端口 ${PORT} 仍被占用，进程树未清理干净`);
    process.exitCode = 1;
    return;
  }
  console.log(`  PASS  停止后端口 ${PORT} 已释放（整棵进程树结束）`);

  fs.unlinkSync(SERVER_SCRIPT);
}

void main();
