/**
 * 端口占用者识别与结束。
 *
 * 场景：Spring Boot 默认端口（8080）经常被上一次没退干净的 java 进程占着，
 * 只提示「端口被占用」用户还得自己去任务管理器找进程。这里提供：
 *   findPortOwners(port)  -> 占用该端口（LISTENING）的进程与命令行
 *   killPortOwners(...)   -> 结束这些进程，返回成功 / 失败清单
 *
 * 平台差异：
 *   Windows 用 netstat -ano 拿 PID，PowerShell（降级 tasklist）补进程名与命令行，
 *   taskkill /T /F 结束整棵进程树。
 *   macOS / Linux 用 lsof -Fpc，没有 lsof 时用 ss -ltnp，再用 ps 补命令行。
 *
 * 不依赖 vscode，便于用自检脚本单独验证解析逻辑。
 */
import { execFile } from 'child_process';
import { t } from '../i18n';

/** 占用某端口的进程（同一 PID 只保留一条） */
export interface PortOwner {
  pid: number;
  /** 进程名，例如 java.exe / java */
  name?: string;
  /** 完整命令行，UI 里需要截断展示 */
  commandLine?: string;
  /** 识别来源，便于排错（netstat / lsof / ss） */
  source?: 'netstat' | 'lsof' | 'ss' | 'tasklist';
}

/** 结束进程的结果 */
export interface KillResult {
  killed: number[];
  failed: Array<{ pid: number; error: string }>;
}

const CMD_TIMEOUT_MS = 8000;

/** 执行命令并返回 stdout；失败时抛出带 stderr 的错误 */
function run(file: string, args: string[], timeout = CMD_TIMEOUT_MS): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || '').toString().trim();
          if (detail && !err.message.includes(detail)) {
            (err as Error).message = `${err.message}：${detail}`;
          }
          reject(err);
          return;
        }
        resolve(stdout.toString());
      }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 取地址串末尾的端口：`0.0.0.0:8080`、`[::]:8080`、`*:8080` 都能解析 */
function trailingPort(address: string): number | undefined {
  const idx = address.lastIndexOf(':');
  if (idx < 0) {
    return undefined;
  }
  const port = Number(address.slice(idx + 1));
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

/** 合并同一 PID 的多条记录（IPv4 / IPv6 各一行） */
function mergeOwners(owners: PortOwner[]): PortOwner[] {
  const byPid = new Map<number, PortOwner>();
  for (const owner of owners) {
    const existed = byPid.get(owner.pid);
    if (!existed) {
      byPid.set(owner.pid, { ...owner });
      continue;
    }
    // 后续记录可能补到进程名或命令行
    byPid.set(owner.pid, {
      ...existed,
      name: existed.name ?? owner.name,
      commandLine: existed.commandLine ?? owner.commandLine
    });
  }
  return Array.from(byPid.values()).sort((a, b) => a.pid - b.pid);
}

/**
 * 解析 Windows `netstat -ano -p TCP` 输出，只保留 LISTENING 且端口匹配的行。
 * 出现 ESTABLISHED 的同端口连接不会被误判为占用者。
 */
export function parseNetstatListeners(output: string, port?: number): PortOwner[] {
  const owners: PortOwner[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !/^TCP\b/i.test(line)) {
      continue;
    }
    // Proto  Local Address  Foreign Address  State  PID
    const parts = line.split(/\s+/);
    if (parts.length < 5) {
      continue;
    }
    if (parts[3].toUpperCase() !== 'LISTENING') {
      continue;
    }
    const localPort = trailingPort(parts[1]);
    if (localPort === undefined || (port !== undefined && localPort !== port)) {
      continue;
    }
    const pid = Number(parts[4]);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    owners.push({ pid, source: 'netstat' });
  }
  return mergeOwners(owners);
}

/**
 * 解析 `lsof -Fpc` 输出。`-F` 模式下每行以字段标记开头：
 *   p<pid> 进程号，c<name> 命令名。
 */
export function parseLsofListeners(output: string): PortOwner[] {
  const owners: PortOwner[] = [];
  let current: PortOwner | undefined;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') {
      const pid = Number(value);
      if (Number.isInteger(pid) && pid > 0) {
        current = { pid, source: 'lsof' };
        owners.push(current);
      } else {
        current = undefined;
      }
    } else if (tag === 'c' && current) {
      current.name = value;
    }
  }
  return mergeOwners(owners);
}

/**
 * 解析 `ss -ltnp` 输出。仅 Linux 使用，进程信息在
 * `users:(("java",pid=1234,fd=103))` 中，没有权限时该段为空。
 */
export function parseSsListeners(output: string, port?: number): PortOwner[] {
  const owners: PortOwner[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^LISTEN\b/i.test(line)) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      continue;
    }
    const localPort = trailingPort(parts[3]);
    if (localPort === undefined || (port !== undefined && localPort !== port)) {
      continue;
    }
    const match = line.match(/users:\(\("([^"]*)",pid=(\d+)/);
    if (!match) {
      continue;
    }
    const pid = Number(match[2]);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    owners.push({ pid, name: match[1] || undefined, source: 'ss' });
  }
  return mergeOwners(owners);
}

/** 解析 `tasklist /FO CSV /NH` 输出：`"java.exe","1234","Console",...` */
function parseTasklist(text: string): Array<{ pid: number; name?: string }> {
  const result: Array<{ pid: number; name?: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('"')) {
      continue;
    }
    const fields = line.split('","');
    if (fields.length < 2) {
      continue;
    }
    const name = fields[0].replace(/^"/, '');
    const pid = Number(fields[1].replace(/"/g, ''));
    if (Number.isInteger(pid) && pid > 0) {
      result.push({ pid, name: name || undefined });
    }
  }
  return result;
}

/** Windows：一次 PowerShell 调用补全多个 PID 的名称与命令行 */
async function describeOnWindows(pids: number[]): Promise<PortOwner[]> {
  const filter = pids.map((pid) => `ProcessId=${pid}`).join(' or ');
  const script =
    `Get-CimInstance Win32_Process -Filter "${filter}" | ` +
    'Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress';
  try {
    const stdout = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    const parsed = JSON.parse(stdout.trim() || '[]') as
      | { ProcessId?: number; Name?: string; CommandLine?: string }
      | Array<{ ProcessId?: number; Name?: string; CommandLine?: string }>;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((item) => typeof item?.ProcessId === 'number')
      .map((item) => ({
        pid: item.ProcessId as number,
        name: item.Name || undefined,
        commandLine: item.CommandLine || undefined,
        source: 'netstat' as const
      }));
  } catch {
    // PowerShell 被禁用 / 执行策略限制时降级为 tasklist（只有进程名）
    const owners: PortOwner[] = [];
    for (const pid of pids) {
      try {
        const stdout = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
        for (const item of parseTasklist(stdout)) {
          owners.push({ ...item, source: 'tasklist' });
        }
      } catch {
        // 单个 PID 查不到时继续下一个，最终由调用方用 netstat 的 PID 兜底
      }
    }
    return owners;
  }
}

/** POSIX：用 ps 补进程名与命令行 */
async function describeOnPosix(pids: number[]): Promise<PortOwner[]> {
  try {
    const stdout = await run('ps', ['-p', pids.join(','), '-o', 'pid=,comm=,args=']);
    const owners: PortOwner[] = [];
    for (const raw of stdout.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) {
        continue;
      }
      const firstSpace = line.indexOf(' ');
      if (firstSpace < 0) {
        continue;
      }
      const pid = Number(line.slice(0, firstSpace));
      if (!Number.isInteger(pid) || pid <= 0) {
        continue;
      }
      const rest = line.slice(firstSpace + 1).trim();
      const secondSpace = rest.indexOf(' ');
      const name = secondSpace < 0 ? rest : rest.slice(0, secondSpace);
      const args = secondSpace < 0 ? '' : rest.slice(secondSpace + 1).trim();
      owners.push({
        pid,
        name: name || undefined,
        commandLine: args || undefined,
        source: 'lsof' as const
      });
    }
    return owners;
  } catch {
    return pids.map((pid) => ({ pid, source: 'lsof' as const }));
  }
}

async function findOnWindows(port: number): Promise<PortOwner[]> {
  let stdout: string;
  try {
    stdout = await run('netstat', ['-ano', '-p', 'TCP']);
  } catch {
    return [];
  }
  const listeners = parseNetstatListeners(stdout, port);
  if (listeners.length === 0) {
    return [];
  }
  const described = await describeOnWindows(listeners.map((item) => item.pid));
  const byPid = new Map(described.map((item) => [item.pid, item]));
  return listeners.map((item) => {
    const detail = byPid.get(item.pid);
    return detail ? { ...detail, source: item.source } : item;
  });
}

async function findOnPosix(port: number): Promise<PortOwner[]> {
  try {
    const stdout = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
    const listeners = parseLsofListeners(stdout);
    if (listeners.length === 0) {
      return [];
    }
    // lsof 的 c 字段只给命令名；命令行再补一次，方便确认是哪个应用
    const described = await describeOnPosix(listeners.map((item) => item.pid));
    const byPid = new Map(described.map((item) => [item.pid, item]));
    return listeners.map((item) => {
      const detail = byPid.get(item.pid);
      return detail ? { ...detail, name: item.name ?? detail.name } : item;
    });
  } catch {
    // lsof 未安装（ENOENT）或无权限时用 ss 兜底
  }
  try {
    const stdout = await run('ss', ['-ltnp']);
    return parseSsListeners(stdout, port);
  } catch {
    return [];
  }
}

/** 查询占用指定端口（LISTENING 状态）的进程 */
export async function findPortOwners(port: number): Promise<PortOwner[]> {
  try {
    return process.platform === 'win32' ? await findOnWindows(port) : await findOnPosix(port);
  } catch {
    // 识别失败不应阻断启动流程，交给调用方降级提示
    return [];
  }
}

/**
 * 进程是否还活着。
 * 用途：结束进程后的确认，以及扩展宿主重启后接管上一会话进程时校验 pid。
 * signal 0 只做存在性检查；Windows 上没有权限时会抛 EPERM，此时进程实际存在，
 * 但扩展通常以当前用户权限运行，遇到 EPERM 保守地认为「已不存在」会丢掉接管能力，
 * 因此按 code 区分：ESRCH 才算不存在。
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface KillOptions {
  /**
   * POSIX 下按进程组结束。扩展宿主重启后接管的进程已经没有句柄，
   * 而 Web Boot 起的 mvn 是独立进程组的组长，只有整组结束才能带走 java 子进程。
   */
  group?: boolean;
}

/** 结束单个进程（Windows 结束整棵进程树） */
export async function killProcessTree(
  pid: number,
  opts: KillOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, error: t('error.invalidPid', pid) };
  }
  if (process.platform === 'win32') {
    try {
      await run('taskkill', ['/PID', String(pid), '/T', '/F']);
      return { ok: true };
    } catch (err) {
      // 128 = 进程不存在，视为已经结束
      if ((err as { code?: string | number }).code === 128) {
        return { ok: true };
      }
      return { ok: false, error: (err as Error).message };
    }
  }

  const send = (signal: NodeJS.Signals): void => {
    // 组模式下先按负 pid 发给整组；进程组不存在时退回单 pid
    if (opts.group) {
      try {
        process.kill(-pid, signal);
        return;
      } catch {
        // fallthrough
      }
    }
    process.kill(pid, signal);
  };

  try {
    send('SIGTERM');
  } catch (err) {
    if (!isPidAlive(pid)) {
      return { ok: true };
    }
    return { ok: false, error: (err as Error).message };
  }
  for (let i = 0; i < 20 && isPidAlive(pid); i++) {
    await sleep(100);
  }
  if (!isPidAlive(pid)) {
    return { ok: true };
  }
  try {
    send('SIGKILL');
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  for (let i = 0; i < 20 && isPidAlive(pid); i++) {
    await sleep(100);
  }
  return isPidAlive(pid) ? { ok: false, error: t('error.processAliveAfterSigkill') } : { ok: true };
}

/** 结束一组占用者，返回成功 / 失败清单 */
export async function killPortOwners(owners: PortOwner[]): Promise<KillResult> {
  const result: KillResult = { killed: [], failed: [] };
  for (const owner of owners) {
    const r = await killProcessTree(owner.pid);
    if (r.ok) {
      result.killed.push(owner.pid);
    } else {
      result.failed.push({ pid: owner.pid, error: r.error ?? t('common.unknownError') });
    }
  }
  return result;
}

/** 一行摘要：`java.exe (pid 1234)`，用于确认对话框标题 */
export function formatOwner(owner: PortOwner): string {
  return `${owner.name || t('common.unknownProcess')} (pid ${owner.pid})`;
}
