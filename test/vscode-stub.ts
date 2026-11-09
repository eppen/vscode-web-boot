/**
 * 自检用的 vscode 桩：只实现自检脚本用到的 API。
 * 仅用于本地验证，不参与扩展打包。
 *
 * - findFiles：扫描 Boot 应用（scanBootApps）用
 * - workspace.getConfiguration：launcher / adopt 读取设置用，可通过 setConfig 覆盖
 * - EventEmitter：BootRunner / MetricsMonitor 的事件用
 * - window.show*Message：接管、停止路径上的提示，全部吞掉
 *
 * 扫描根目录由 setScanRoot 指定：npm script 的 cwd 是扩展目录，
 * 而扫描目标是仓库根，不能依赖 process.cwd()。
 */
import * as fs from 'fs';
import * as path from 'path';

let scanRoot = process.cwd();

export function setScanRoot(dir: string): void {
  scanRoot = path.resolve(dir);
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === '.git') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (
      entry.name.endsWith('Application.java') &&
      full.includes(`${path.sep}src${path.sep}main${path.sep}java${path.sep}`)
    ) {
      out.push(full);
    }
  }
}

let configValues: Record<string, unknown> = {};

/** 覆盖 webBoot.* 设置（只影响自检进程） */
export function setConfig(values: Record<string, unknown>): void {
  configValues = { ...values };
}

export const workspace = {
  findFiles: async (): Promise<{ fsPath: string }[]> => {
    const files: string[] = [];
    walk(scanRoot, files);
    return files.map((fsPath) => ({ fsPath }));
  },
  getConfiguration: (section?: string): { get: <T>(key: string, fallback?: T) => T | undefined } => ({
    get: <T>(key: string, fallback?: T): T | undefined => {
      const full = section ? `${section}.${key}` : key;
      const short = full.startsWith('webBoot.') ? full.slice('webBoot.'.length) : full;
      if (Object.prototype.hasOwnProperty.call(configValues, short)) {
        return configValues[short] as T;
      }
      return fallback;
    }
  })
};

export class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  readonly event = (listener: (value: T) => void): { dispose: () => void } => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value: T): void {
    for (const listener of Array.from(this.listeners)) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export const window = {
  showInformationMessage: async (): Promise<undefined> => undefined,
  showWarningMessage: async (): Promise<undefined> => undefined,
  showErrorMessage: async (): Promise<undefined> => undefined
};

export const env = {
  language: 'en',
  openExternal: async (): Promise<boolean> => true
};

export const Uri = {
  file: (fsPath: string): { fsPath: string } => ({ fsPath }),
  parse: (value: string): { toString: () => string } => ({ toString: () => value })
};
