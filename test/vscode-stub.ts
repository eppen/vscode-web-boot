/**
 * 自检用的 vscode 桩：只实现 scanBootApps 用到的 workspace.findFiles。
 * 仅用于本地验证扫描结果，不参与扩展打包。
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

export const workspace = {
  findFiles: async (): Promise<{ fsPath: string }[]> => {
    const files: string[] = [];
    walk(scanRoot, files);
    return files.map((fsPath) => ({ fsPath }));
  }
};
