/**
 * 把扫描结果写成等价的 `.vscode/launch.json` 配置，方便习惯按 F5 的人。
 *
 * 只替换名字以 "Web Boot: " 开头的条目，其它配置一律保留。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { AppPreference, BootApp } from '../model/types';

export interface LaunchJsonDeps {
  getPreference: (appId: string) => AppPreference;
  resolveProfile: (app: BootApp, pref?: AppPreference) => string;
  resolvePort: (app: BootApp, profile: string, pref?: AppPreference) => number;
}

const CONFIG_PREFIX = 'Web Boot: ';

/** 去掉 // 与 * 注释，并清理尾随逗号，兼容 JSONC 的 launch.json */
function parseJsonc(text: string): Record<string, unknown> {
  const noComments = text
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)|(\/\*[\s\S]*?\*\/)/gm, (m: string, line?: string, block?: string) =>
      line || block ? '' : m
    )
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noComments) as Record<string, unknown>;
}

export function buildLaunchConfigs(
  apps: BootApp[],
  deps: LaunchJsonDeps
): Record<string, unknown>[] {
  return apps.map((app) => {
    const pref = deps.getPreference(app.id);
    const profile = deps.resolveProfile(app, pref);
    const port = deps.resolvePort(app, profile, pref);
    return {
      type: 'java',
      name: `${CONFIG_PREFIX}${app.id} (${profile || 'default'} :${port})`,
      request: 'launch',
      cwd: '${workspaceFolder}',
      mainClass: app.mainClass,
      projectName: app.id.split('#')[0],
      args: [profile ? `--spring.profiles.active=${profile}` : '', `--server.port=${port}`]
        .filter(Boolean)
        .join(' '),
      vmArgs: '-Dspring.devtools.restart.enabled=false'
    };
  });
}

/** 写入 .vscode/launch.json，返回写入路径与被替换的条数 */
export function writeLaunchJson(
  root: string,
  configs: Record<string, unknown>[]
): { file: string; replaced: number; kept: number } {
  const file = path.join(root, '.vscode', 'launch.json');
  let doc: Record<string, unknown> = { version: '0.2.0', configurations: [] };

  if (fs.existsSync(file)) {
    try {
      doc = parseJsonc(fs.readFileSync(file, 'utf8'));
    } catch {
      // 解析失败时保留原文件内容到备份，再整体重建
      try {
        fs.copyFileSync(file, `${file}.bak`);
      } catch {
        // 备份失败不阻断
      }
      doc = { version: '0.2.0', configurations: [] };
    }
  }

  const existing = Array.isArray(doc.configurations)
    ? (doc.configurations as Record<string, unknown>[])
    : [];
  const kept = existing.filter(
    (c) => typeof c?.name !== 'string' || !c.name.startsWith(CONFIG_PREFIX)
  );
  const replaced = existing.length - kept.length;

  doc.version = doc.version ?? '0.2.0';
  doc.configurations = [...kept, ...configs];

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return { file, replaced, kept: kept.length };
}

export { CONFIG_PREFIX };
