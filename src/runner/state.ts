/**
 * 运行期状态快照。
 *
 * 为什么需要：扩展宿主（extension host）重启时内存里的 AppRuntime 会全部丢失，
 * 但 `mvn spring-boot:run` 起出来的进程并不会跟着退出。把「谁在跑」写进
 * VS Code 的 workspaceState（本机、按工作区、不进 git），下次 activate 时
 * 校验 pid 还在就接管，用户看到的仍是「运行中」，可以直接停止 / 打开 / 重启。
 *
 * 本模块只做数据校验与序列化，不 import vscode，便于自检脚本单独验证。
 */
import type { AppState, CoverageSummary } from '../model/types';

/** workspaceState 里的 key；带版本号，格式变了就换 key，避免读到旧结构 */
export const RUNTIME_STATE_KEY = 'webBoot.runtime.v1';
export const RUNTIME_STATE_VERSION = 1;

/** 快照里的覆盖率信息：够重建上下文 + 展示上次的指标即可 */
export interface PersistedCoverage {
  port?: number;
  execFile?: string;
  reportDir?: string;
  xmlFile?: string;
  enabled?: boolean;
  summary?: CoverageSummary;
}

/** 一个应用的运行期快照 */
export interface PersistedAppRuntime {
  appId: string;
  state: AppState;
  /** 受管进程（shell / mvn）的 pid，接管与结束都靠它 */
  pid: number;
  port?: number;
  contextPath?: string;
  profile?: string;
  debug: boolean;
  startedAt?: number;
  lastCommand?: string;
  coverage?: PersistedCoverage;
}

export interface PersistedRuntimes {
  version: number;
  savedAt: number;
  apps: PersistedAppRuntime[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 正整数；其余（0 / 负数 / 小数 / NaN / 字符串）一律丢弃 */
function toPositiveInt(value: unknown): number | undefined {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isInteger(num) && num > 0 ? num : undefined;
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 只接受仍然可能有进程在跑的状态。
 * stopped 不必记；stopping 是过渡态，重启后按 stopped 处理更安全。
 */
function toLiveState(value: unknown): AppState | undefined {
  return value === 'running' || value === 'starting' ? value : undefined;
}

function sanitizeCoverage(raw: unknown): PersistedCoverage | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const coverage: PersistedCoverage = {
    port: toPositiveInt(raw.port),
    execFile: toStringOrUndefined(raw.execFile),
    reportDir: toStringOrUndefined(raw.reportDir),
    xmlFile: toStringOrUndefined(raw.xmlFile),
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : undefined,
    summary: isRecord(raw.summary) ? (raw.summary as unknown as CoverageSummary) : undefined
  };
  // 没有任何可用字段时当作没有覆盖率信息
  return coverage.port || coverage.execFile ? coverage : undefined;
}

function sanitizeEntry(raw: unknown): PersistedAppRuntime | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const appId = toStringOrUndefined(raw.appId);
  const pid = toPositiveInt(raw.pid);
  const state = toLiveState(raw.state);
  if (!appId || !pid || !state) {
    return undefined;
  }
  return {
    appId,
    state,
    pid,
    port: toPositiveInt(raw.port),
    contextPath: typeof raw.contextPath === 'string' ? raw.contextPath : undefined,
    profile: typeof raw.profile === 'string' ? raw.profile : undefined,
    debug: raw.debug === true,
    startedAt: toPositiveInt(raw.startedAt),
    lastCommand: toStringOrUndefined(raw.lastCommand),
    coverage: sanitizeCoverage(raw.coverage)
  };
}

/**
 * 校验读回来的快照：结构不对、字段缺失、同一 appId 重复的记录都丢掉。
 * 任何异常输入都退化成空数组，绝不抛错（状态文件坏掉不该让扩展起不来）。
 */
export function sanitizeRuntimes(raw: unknown): PersistedAppRuntime[] {
  if (!isRecord(raw) || !Array.isArray(raw.apps)) {
    return [];
  }
  const seen = new Set<string>();
  const apps: PersistedAppRuntime[] = [];
  for (const item of raw.apps) {
    const entry = sanitizeEntry(item);
    if (!entry || seen.has(entry.appId)) {
      continue;
    }
    seen.add(entry.appId);
    apps.push(entry);
  }
  return apps;
}

/** 组装待写入的快照 */
export function buildSnapshot(apps: PersistedAppRuntime[], now = Date.now()): PersistedRuntimes {
  return { version: RUNTIME_STATE_VERSION, savedAt: now, apps };
}
