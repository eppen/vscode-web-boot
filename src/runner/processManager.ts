/**
 * 进程管理：启动 mvn 子进程、按行回调输出、停止整棵进程树。
 *
 * Windows 下必须用 `taskkill /T /F`，因为 `shell: true` 起的是 cmd.exe，
 * 只杀 cmd 会留下 java 子进程占着端口（这正是「Stop 后端口还在」的常见原因）。
 */
import { ChildProcess, execFile, spawn } from 'child_process';
import { TextDecoder } from 'util';
import { t } from '../i18n';

export interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  onLine: (line: string) => void;
  onExit?: (code: number | null) => void;
}

export interface ManagedProcess {
  pid: number;
  stop: () => Promise<void>;
  kill: () => void;
}

/** 去掉 ANSI 颜色码，便于正则匹配 Spring Boot 的就绪日志 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

let utf8Strict: TextDecoder | undefined;
let utf8Loose: TextDecoder | undefined;
let gbk: TextDecoder | null | undefined;

function getUtf8Strict(): TextDecoder {
  if (!utf8Strict) {
    utf8Strict = new TextDecoder('utf-8', { fatal: true });
  }
  return utf8Strict;
}

function getUtf8Loose(): TextDecoder {
  if (!utf8Loose) {
    utf8Loose = new TextDecoder('utf-8');
  }
  return utf8Loose;
}

/**
 * GBK 解码器依赖宿主 ICU，极端环境下可能构造失败；
 * 失败时返回 null，由调用方降级为非严格 UTF-8（即旧行为，不会崩）。
 */
function getGbk(): TextDecoder | null {
  if (gbk === undefined) {
    try {
      gbk = new TextDecoder('gbk');
    } catch {
      gbk = null;
    }
  }
  return gbk;
}

/**
 * 按行自动识别编码：整行是合法 UTF-8 就按 UTF-8 解，
 * 否则按 GBK 解（JDK 8 + Windows 默认 file.encoding=GBK 的中文日志）。
 * 只在换行边界调用，所以不会被 chunk 边界切断的半个汉字影响。
 */
export function decodeLine(buf: Buffer): string {
  if (buf.length === 0) {
    return '';
  }
  try {
    return getUtf8Strict().decode(buf);
  } catch {
    const gbkDecoder = getGbk();
    if (gbkDecoder) {
      return gbkDecoder.decode(buf);
    }
    return getUtf8Loose().decode(buf);
  }
}

function taskkill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 启动一个受管子进程，返回句柄 */
export function spawnManaged(command: string, options: SpawnOptions): ManagedProcess {
  const isWindows = process.platform === 'win32';
  const child: ChildProcess = spawn(command, {
    cwd: options.cwd,
    env: options.env,
    shell: true,
    windowsHide: true,
    // 非 Windows 需要独立进程组，才能整组结束
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // 按字节缓冲，只在换行边界解码，避免半个汉字被 chunk 边界切断
  let pending: Buffer = Buffer.alloc(0);
  let exited = false;

  const emitLine = (line: Buffer): void => {
    const text = stripAnsi(decodeLine(line));
    if (text.length > 0) {
      options.onLine(text);
    }
  };

  const flush = (chunk: Buffer | null, final = false): void => {
    if (chunk && chunk.length > 0) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    }
    // Maven 的下载进度用 \r 刷新，统一当作换行处理（\r\n 视为一个换行）
    let start = 0;
    for (let i = 0; i < pending.length; i++) {
      const byte = pending[i];
      if (byte !== 0x0a && byte !== 0x0d) {
        continue;
      }
      emitLine(pending.subarray(start, i));
      if (byte === 0x0d && i + 1 < pending.length && pending[i + 1] === 0x0a) {
        i++;
      }
      start = i + 1;
    }
    // 未结束的行留在 buffer 里，等下一次数据拼接；复制出去避免长时间引用大 chunk
    pending = start === 0 ? pending : Buffer.from(pending.subarray(start));
    if (final && pending.length > 0) {
      emitLine(pending);
      pending = Buffer.alloc(0);
    }
  };

  child.stdout?.on('data', (chunk: Buffer) => flush(chunk));
  child.stderr?.on('data', (chunk: Buffer) => flush(chunk));

  const handleExit = (code: number | null): void => {
    if (exited) {
      return;
    }
    exited = true;
    flush(null, true);
    options.onExit?.(code);
  };

  child.on('error', (err) => {
    options.onLine(t('log.spawnFailed', err.message));
    handleExit(-1);
  });
  child.on('close', handleExit);

  const pid = child.pid ?? -1;

  const stop = async (): Promise<void> => {
    if (exited || pid <= 0) {
      return;
    }
    if (isWindows) {
      await taskkill(pid);
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // 进程可能已退出
        }
      }
    }
    // 等待退出，超时后强制
    for (let i = 0; i < 20 && !exited; i++) {
      await sleep(150);
    }
    if (!exited && isWindows) {
      await taskkill(pid);
    }
  };

  return {
    pid,
    stop,
    kill: () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
  };
}
