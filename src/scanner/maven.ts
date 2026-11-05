/**
 * Maven reactor 扫描。
 *
 * 关键点：pom.xml 里被 <!-- --> 注释掉的 <module> 不算 reactor 成员。
 * 本仓库根 pom.xml 中 `<module>mes-monitor-server</module>` 就是被注释的状态，
 * 若直接用正则抓 <module>，会误判它属于 reactor，导致 `mvn -pl :mes-monitor-server`
 * 报 "Could not find the selected project in the reactor"。所以必须先剥离注释。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { MavenModule } from '../model/types';

/** 去掉 XML 注释，保留换行以便报错时行号仍有参考意义 */
function stripXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 从 pom.xml 文本中取本项目自己的 artifactId（跳过 <parent> 段） */
export function parseArtifactId(xml: string): string | undefined {
  const cleaned = stripXmlComments(xml).replace(/<parent>[\s\S]*?<\/parent>/g, '');
  const m = cleaned.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/);
  return m ? m[1].trim() : undefined;
}

/** 从 pom.xml 文本中取 packaging，默认 jar */
export function parsePackaging(xml: string): string {
  const cleaned = stripXmlComments(xml);
  const m = cleaned.match(/<packaging>\s*([^<]+?)\s*<\/packaging>/);
  return m ? m[1].trim() : 'jar';
}

/** 取 <modules> 下的子模块名（已剥离注释，注释掉的模块不会返回） */
export function parseModules(xml: string): string[] {
  const cleaned = stripXmlComments(xml);
  const modules: string[] = [];
  const blockRe = /<modules>([\s\S]*?)<\/modules>/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(cleaned)) !== null) {
    const inner = block[1];
    const itemRe = /<module>\s*([^<]+?)\s*<\/module>/g;
    let item: RegExpExecArray | null;
    while ((item = itemRe.exec(inner)) !== null) {
      modules.push(item[1].trim());
    }
  }
  return modules;
}

/**
 * 取被 <!-- --> 注释掉的 <module> 名。
 * 用于区分「父 pom 里写了但被注释」与「从未声明」两种情况，给用户更准确的提示。
 */
export function parseCommentedModules(xml: string): string[] {
  const names: string[] = [];
  const commentRe = /<!--([\s\S]*?)-->/g;
  let comment: RegExpExecArray | null;
  while ((comment = commentRe.exec(xml)) !== null) {
    const itemRe = /<module>\s*([^<]+?)\s*<\/module>/g;
    let item: RegExpExecArray | null;
    while ((item = itemRe.exec(comment[1])) !== null) {
      names.push(item[1].trim());
    }
  }
  return names;
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * 递归扫描根 pom.xml 的 reactor，返回 模块目录绝对路径 -> MavenModule。
 * 包含根工程自身（packaging=pom）。
 */
export function scanReactor(rootDir: string): Map<string, MavenModule> {
  const result = new Map<string, MavenModule>();

  const walk = (dir: string, depth: number): void => {
    // 仓库层级不深，5 层足够，避免异常结构导致无限递归
    if (depth > 5) {
      return;
    }
    const pomPath = path.join(dir, 'pom.xml');
    const xml = readText(pomPath);
    if (!xml) {
      return;
    }
    const artifactId = parseArtifactId(xml);
    if (artifactId) {
      result.set(path.resolve(dir), {
        dir: path.resolve(dir),
        relDir: toPosix(path.relative(rootDir, path.resolve(dir))) || '.',
        artifactId,
        packaging: parsePackaging(xml)
      });
    }
    for (const sub of parseModules(xml)) {
      walk(path.resolve(dir, sub), depth + 1);
    }
  };

  walk(rootDir, 0);

  // 根工程 relDir 为空字符串时用 '.'，便于展示
  const rootResolved = path.resolve(rootDir);
  const rootModule = result.get(rootResolved);
  if (rootModule) {
    rootModule.relDir = '.';
  }
  return result;
}

/** 读取单个 pom.xml 的 artifactId（用于 reactor 之外的模块） */
export function readPomArtifactId(pomPath: string): string | undefined {
  const xml = readText(pomPath);
  return xml ? parseArtifactId(xml) : undefined;
}

/** 读取单个 pom.xml 的 packaging */
export function readPomPackaging(pomPath: string): string {
  const xml = readText(pomPath);
  return xml ? parsePackaging(xml) : 'jar';
}
