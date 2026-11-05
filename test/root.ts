/**
 * 定位仓库根目录（含 mes-parent 的 pom.xml），供自检脚本使用。
 *
 * 本扩展已移出仓库（D:\work\tools\vscode-web-boot），无法再从 __dirname
 * 向上找到 mes-parent，因此按以下优先级解析：
 *   1. 命令行参数 --root <path>
 *   2. 环境变量 MES_REPO_ROOT
 *   3. 从 __dirname 向上查找
 *   4. 从 process.cwd() 向上查找（在仓库根目录直接 node 运行脚本时可用）
 */
import * as fs from 'fs';
import * as path from 'path';

const MARKER = '<artifactId>mes-parent</artifactId>';

/** 判断某目录是否为 mes-parent 仓库根 */
function isRepoRoot(dir: string): boolean {
  const pom = path.join(dir, 'pom.xml');
  if (!fs.existsSync(pom)) {
    return false;
  }
  try {
    return fs.readFileSync(pom, 'utf8').includes(MARKER);
  } catch {
    return false;
  }
}

/** 从 start 向上逐级查找 */
function searchUpward(start: string): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    if (isRepoRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** 取 --root 参数值 */
function argRoot(argv: string[]): string | undefined {
  const idx = argv.indexOf('--root');
  if (idx >= 0 && idx + 1 < argv.length) {
    return argv[idx + 1];
  }
  const eq = argv.find((a) => a.startsWith('--root='));
  return eq ? eq.substring('--root='.length) : undefined;
}

export function findRepoRoot(fromDir: string): string {
  const fromArg = argRoot(process.argv.slice(2));
  if (fromArg) {
    const resolved = path.resolve(fromArg);
    if (isRepoRoot(resolved)) {
      return resolved;
    }
    throw new Error(`--root 指定的目录不含 mes-parent 的 pom.xml：${resolved}`);
  }

  const fromEnv = process.env.MES_REPO_ROOT;
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    if (isRepoRoot(resolved)) {
      return resolved;
    }
    throw new Error(`MES_REPO_ROOT 指定的目录不含 mes-parent 的 pom.xml：${resolved}`);
  }

  const found = searchUpward(fromDir) ?? searchUpward(process.cwd());
  if (found) {
    return found;
  }

  throw new Error(
    [
      '未找到包含 mes-parent 的 pom.xml。',
      '本扩展位于仓库之外，请显式指定仓库根，例如：',
      '  npm run selfcheck -- --root D:/work/jt-mes/source/mes/mes-parent',
      '或设置环境变量：',
      '  $env:MES_REPO_ROOT = "D:/work/jt-mes/source/mes/mes-parent"'
    ].join('\n')
  );
}
