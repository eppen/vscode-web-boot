/**
 * 进程管理：启动 mvn 子进程、按行回调输出、停止整棵进程树。
 *
 * Windows 下必须用 `taskkill /T /F`，因为 `shell: true` 起的是 cmd.exe，
 * 只杀 cmd 会留下 java 子进程占着端口（这正是「Stop 后端口还在」的常见原因）。
 */
import { ChildProcess, execFile, spawn } from 'child_process';

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

  let buffer = '';
  let exited = false;

  const flush = (chunk: string, final = false): void => {
    buffer += chunk;
    // Maven 的下载进度用 \r 刷新，统一当作换行处理
    const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    // 未结束的行留在 buffer 里，等下一次数据拼接
    buffer = final ? '' : lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > 0) {
        options.onLine(stripAnsi(line));
      }
    }
  };

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (data: string) => flush(data));
  child.stderr?.on('data', (data: string) => flush(data));

  const handleExit = (code: number | null): void => {
    if (exited) {
      return;
    }
    exited = true;
    flush('', true);
    options.onExit?.(code);
  };

  child.on('error', (err) => {
    options.onLine(`[启动失败] ${err.message}`);
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
