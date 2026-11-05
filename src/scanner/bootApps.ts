/**
 * 扫描工作区内所有可启动的 Spring Boot 应用。
 *
 * 策略：先找 `src/main/java/**\/*Application.java`（本仓库命名统一），
 * 再读文件确认含 @SpringBootApplication，最后向上找最近的 pom.xml 定位模块。
 * 这样能同时发现 reactor 内与 reactor 外的应用（如 mes-monitor-server、mes-agentscope）。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { BootApp, MavenModule } from '../model/types';
import { parseCommentedModules, parsePackaging, readPomArtifactId } from './maven';
import { readSpringConfig } from './springConfig';

const MAIN_CLASS_GLOB = '**/src/main/java/**/*Application.java';
const EXCLUDE_GLOB = '**/{node_modules,target,dist,out,.git}/**';

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** 向上查找最近的含 pom.xml 的目录（不越过工作区根） */
function findModuleDir(file: string, root: string): string | undefined {
  let dir = path.dirname(file);
  const rootResolved = path.resolve(root);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pom.xml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir || path.resolve(dir) === rootResolved) {
      return undefined;
    }
    dir = parent;
  }
}

/** 从启动类里换出主类全限定名 */
function resolveMainClass(file: string): string {
  // src/main/java 之后的路径即为包名
  const normalized = toPosix(file);
  const marker = '/src/main/java/';
  const idx = normalized.lastIndexOf(marker);
  if (idx < 0) {
    return path.basename(file, '.java');
  }
  const rel = normalized.substring(idx + marker.length).replace(/\.java$/, '');
  return rel.split('/').join('.');
}

/** 收集根 pom 中被注释的 module 名，用于生成提示 */
function collectCommentedModules(root: string): Set<string> {
  const names = new Set<string>();
  try {
    const xml = fs.readFileSync(path.join(root, 'pom.xml'), 'utf8');
    for (const n of parseCommentedModules(xml)) {
      names.add(path.basename(n.replace(/[\\/]+$/, '')));
    }
  } catch {
    // 根 pom 不存在时忽略
  }
  return names;
}

/**
 * 扫描所有 Spring Boot 应用。
 * @param root 工作区根目录
 * @param reactor scanReactor 的结果
 */
export async function scanBootApps(
  root: string,
  reactor: Map<string, MavenModule>
): Promise<BootApp[]> {
  const uris = await vscode.workspace.findFiles(MAIN_CLASS_GLOB, EXCLUDE_GLOB);
  const commentedModules = collectCommentedModules(root);
  const apps: BootApp[] = [];
  const usedIds = new Set<string>();

  for (const uri of uris) {
    const file = uri.fsPath;
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('@SpringBootApplication')) {
      continue;
    }

    const moduleDir = findModuleDir(file, root);
    if (!moduleDir) {
      continue;
    }
    const moduleResolved = path.resolve(moduleDir);
    const reactorModule = reactor.get(moduleResolved);
    const pomPath = path.join(moduleResolved, 'pom.xml');
    const artifactId = reactorModule?.artifactId ?? readPomArtifactId(pomPath) ?? path.basename(moduleResolved);
    const packaging = reactorModule?.packaging ?? parsePackaging(fs.readFileSync(pomPath, 'utf8'));

    const relDir = toPosix(path.relative(path.resolve(root), moduleResolved)) || '.';
    const simpleName = path.basename(file, '.java');

    // 同一模块出现多个启动类时，用 类名 区分
    let id = artifactId;
    if (usedIds.has(id)) {
      id = `${artifactId}#${simpleName}`;
    }
    let suffix = 2;
    const baseId = id;
    while (usedIds.has(id)) {
      id = `${baseId}(${suffix++})`;
    }
    usedIds.add(id);

    let reactorNote: string | undefined;
    if (!reactorModule) {
      const leaf = path.basename(moduleResolved);
      reactorNote = commentedModules.has(leaf)
        ? '不在 reactor：父 pom 中的 <module> 被注释掉'
        : '不在 reactor：父 pom 未声明该模块';
    }

    apps.push({
      id,
      dir: moduleResolved,
      relDir,
      mainClass: resolveMainClass(file),
      mainClassFile: file,
      inReactor: !!reactorModule,
      reactorNote,
      packaging,
      config: readSpringConfig(moduleResolved)
    });
  }

  // reactor 内的排前面，其次按 id 字典序
  apps.sort((a, b) => {
    if (a.inReactor !== b.inReactor) {
      return a.inReactor ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });

  return apps;
}
