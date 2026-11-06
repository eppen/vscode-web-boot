/**
 * 输出编码自检：验证「按行自动识别 UTF-8 / GBK」。
 *
 * 背景：Windows 中文环境下 `mvn spring-boot:run` fork 的 JVM 默认 file.encoding=GBK，
 * logback 控制台 appender 输出的是 GBK 字节；扩展若固定按 UTF-8 解码就会出现
 * 「鐢ㄦ埛」这类乱码。这里把判定固化成可跑的验收点。
 * 仅用于验证，不参与扩展打包。
 */
import * as fs from 'fs';
import * as path from 'path';
import { decodeLine, spawnManaged } from '../src/runner/processManager';

// 「用户登录成功」的 GBK 字节
const GBK_LOGIN = Buffer.from([0xd3, 0xc3, 0xbb, 0xa7, 0xb5, 0xc7, 0xc2, 0xbc, 0xb3, 0xc9, 0xb9, 0xa6]);
// 「启动完成」的 GBK 字节
const GBK_READY = Buffer.from([0xc6, 0xf4, 0xb6, 0xaf, 0xcd, 0xea, 0xb3, 0xc9]);

interface Case {
  name: string;
  bytes: Buffer;
  expect: string;
}

const cases: Case[] = [
  { name: 'UTF-8 中文行原样输出', bytes: Buffer.from('用户登录成功', 'utf8'), expect: '用户登录成功' },
  { name: 'GBK 中文行按 GBK 解码', bytes: GBK_LOGIN, expect: '用户登录成功' },
  { name: 'GBK 中文行（启动完成）按 GBK 解码', bytes: GBK_READY, expect: '启动完成' },
  {
    name: '纯 ASCII 行（就绪检测依赖）原样输出',
    bytes: Buffer.from('2026-11-06 INFO Started MesApplication in 86.856 seconds', 'utf8'),
    expect: '2026-11-06 INFO Started MesApplication in 86.856 seconds'
  },
  { name: 'UTF-8 三字节中文原样输出', bytes: Buffer.from('启动完成', 'utf8'), expect: '启动完成' },
  { name: '空 buffer 解出空串', bytes: Buffer.alloc(0), expect: '' }
];

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

// 逐行解码（同一条流里 GBK 的 mvn 提示与 UTF-8 的应用日志可混排）
for (const testCase of cases) {
  check(testCase.name, decodeLine(testCase.bytes), testCase.expect);
}

check(
  'GBK 行与 UTF-8 行相邻各自正确（mvn 提示与应用日志混排）',
  [decodeLine(GBK_LOGIN), decodeLine(Buffer.from('启动完成', 'utf8'))].join('\n'),
  '用户登录成功\n启动完成'
);

// 端到端：真实子进程输出 GBK / UTF-8 混排，验证切行 + 解码 + ANSI 清理 + 结尾残留行
const CHILD_SCRIPT = path.join(__dirname, '.tmp-encoding-child.cjs');

function writeChildScript(): void {
  const script = [
    'const gbkLogin = Buffer.from([0xd3, 0xc3, 0xbb, 0xa7, 0xb5, 0xc7, 0xc2, 0xbc, 0xb3, 0xc9, 0xb9, 0xa6]);',
    'const esc = String.fromCharCode(27);',
    'process.stdout.write(gbkLogin);',
    "process.stdout.write('\\r\\n');",
    "process.stdout.write(Buffer.from('启动完成\\n', 'utf8'));",
    "process.stdout.write(Buffer.from(esc + '[32mINFO' + esc + '[0m 中文 OK\\n', 'utf8'));",
    "process.stdout.write('进度 1\\r进度 2\\n');",
    'process.stdout.write(Buffer.from([0xc6, 0xf4, 0xb6, 0xaf]));',
    ''
  ].join('\n');
  fs.writeFileSync(CHILD_SCRIPT, script, 'utf8');
}

function runChild(): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const proc = spawnManaged(`node "${CHILD_SCRIPT}"`, {
      cwd: __dirname,
      env: process.env,
      onLine: (line) => lines.push(line),
      onExit: () => resolve(lines)
    });
    setTimeout(() => {
      void proc.stop();
      resolve(lines);
    }, 20000);
  });
}

async function main(): Promise<void> {
  writeChildScript();
  const lines = await runChild();
  try {
    fs.unlinkSync(CHILD_SCRIPT);
  } catch {
    // 文件可能已被清理
  }

  const expected = ['用户登录成功', '启动完成', 'INFO 中文 OK', '进度 1', '进度 2', '启动'];
  check(
    '真实子进程：GBK / UTF-8 / ANSI / \\r 进度 / 结尾残留行',
    lines.join('|'),
    expected.join('|'),
    `实际输出：${JSON.stringify(lines)}`
  );

  const garbled = lines.some((line) => line.includes('鐢') || line.includes('鍚'));
  check('真实子进程：无「鐢ㄦ埛」类乱码', String(!garbled), 'true', `实际输出：${JSON.stringify(lines)}`);

  console.log('');
  console.log(failed === 0 ? '全部通过' : `失败 ${failed} 条`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
