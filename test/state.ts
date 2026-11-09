/**
 * 跨会话状态快照自检：
 * 1. sanitizeRuntimes 对坏数据不抛错，只保留合法项（状态文件坏掉不能让扩展起不来）
 * 2. 只接受 running / starting —— 其余状态没有可接管的进程
 * 3. buildSnapshot 带上版本号，便于以后换 key / 迁移
 * 4. isPidAlive / killProcessTree 的边界（pid 非法、进程不存在）
 * 仅用于验证，不参与扩展打包。
 */
import { RUNTIME_STATE_VERSION, buildSnapshot, sanitizeRuntimes } from '../src/runner/state';
import { isPidAlive, killProcessTree } from '../src/util/portProcess';

let failed = 0;

/** 按键名排序后再序列化，避免对象字面量的字段顺序影响比较结果 */
function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function check(name: string, actual: unknown, expected: unknown): void {
  const a = stable(actual);
  const e = stable(expected);
  if (a === e) {
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        期望: ${e}`);
    console.log(`        实际: ${a}`);
  }
}

function checkTrue(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

// ---------- 坏数据 ----------
check('undefined -> []', sanitizeRuntimes(undefined), []);
check('null -> []', sanitizeRuntimes(null), []);
check('字符串 -> []', sanitizeRuntimes('garbage'), []);
check('数组 -> []', sanitizeRuntimes([]), []);
check('apps 不是数组 -> []', sanitizeRuntimes({ apps: { a: 1 } }), []);
check('apps 里的散装值被丢掉', sanitizeRuntimes({ apps: [null, 1, 'x', []] }), []);

// ---------- 必填字段 ----------
const base = { appId: 'mes-web', pid: 1234, state: 'running' as const, debug: false };
check('缺 pid 丢掉', sanitizeRuntimes({ apps: [{ ...base, pid: undefined }] }), []);
check('pid 为 0 丢掉', sanitizeRuntimes({ apps: [{ ...base, pid: 0 }] }), []);
check('pid 为负数丢掉', sanitizeRuntimes({ apps: [{ ...base, pid: -5 }] }), []);
check('缺 appId 丢掉', sanitizeRuntimes({ apps: [{ ...base, appId: '' }] }), []);
check('stopped 丢掉', sanitizeRuntimes({ apps: [{ ...base, state: 'stopped' }] }), []);
check('stopping 丢掉', sanitizeRuntimes({ apps: [{ ...base, state: 'stopping' }] }), []);
check(
  'pid 是数字字符串时归一化',
  sanitizeRuntimes({ apps: [{ ...base, pid: '4321' }] }),
  [{ appId: 'mes-web', pid: 4321, state: 'running', debug: false }]
);

// ---------- 完整条目 ----------
const full = {
  appId: 'mes-web',
  state: 'running',
  pid: 4242,
  port: 8080,
  contextPath: '/api',
  profile: 'dev',
  debug: true,
  startedAt: 1700000000000,
  lastCommand: 'mvn spring-boot:run',
  coverage: { enabled: true, port: 6300, execFile: 'C:/ws/.vscode/web-boot/coverage/mes-web/jacoco.exec' }
};
check('完整条目原样保留', sanitizeRuntimes({ version: 1, savedAt: 1, apps: [full] }), [full]);

check(
  'starting 状态保留（重启时可能还在起）',
  sanitizeRuntimes({ apps: [{ ...base, state: 'starting' }] }).map((e) => e.state),
  ['starting']
);

check(
  'debug 非布尔按 false',
  sanitizeRuntimes({ apps: [{ ...base, debug: 'yes' }] })[0].debug,
  false
);

// ---------- appId 去重 ----------
check(
  '同一 appId 只保留第一条',
  sanitizeRuntimes({ apps: [base, { ...base, pid: 9999 }] }).map((e) => e.pid),
  [1234]
);

// ---------- 覆盖率清洗 ----------
check(
  '覆盖率没有 port / exec 时丢弃',
  sanitizeRuntimes({ apps: [{ ...base, coverage: { enabled: true } }] })[0].coverage,
  undefined
);
check(
  '覆盖率 summary 原样保留',
  sanitizeRuntimes({
    apps: [{ ...base, coverage: { port: 6300, summary: { line: { covered: 1, missed: 0 } } } }]
  })[0].coverage?.summary,
  { line: { covered: 1, missed: 0 } }
);

// ---------- buildSnapshot ----------
const snapshot = buildSnapshot([full as never], 12345);
check('版本号写入', snapshot.version, RUNTIME_STATE_VERSION);
check('savedAt 用传入时间', snapshot.savedAt, 12345);
check('apps 原样带出', snapshot.apps.length, 1);
check('快照能被自己读回来', sanitizeRuntimes(snapshot).length, 1);

// ---------- pid 存活检查 ----------
checkTrue('当前进程活着', isPidAlive(process.pid));
check('pid 0 视为不存在', isPidAlive(0), false);
check('负 pid 视为不存在', isPidAlive(-1), false);
check('不存在的超大 pid', isPidAlive(2_000_000_000), false);

(async (): Promise<void> => {
  const bad = await killProcessTree(0);
  check('killProcessTree 拒绝非法 pid', bad.ok, false);
  checkTrue('非法 pid 带错误信息', typeof bad.error === 'string' && bad.error.length > 0);

  console.log('');
  console.log(failed === 0 ? '全部通过' : `失败 ${failed} 项`);
  process.exitCode = failed === 0 ? 0 : 1;
})();
