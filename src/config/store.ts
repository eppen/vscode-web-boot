/**
 * 个人偏好存储：.vscode/web-boot.json
 *
 * 放在 .vscode/ 下，因为本仓库 .gitignore 已忽略该目录，
 * 属于「本机个人配置」，不会误提交。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { AppPreference, MesBootConfig } from '../model/types';

const FILE_REL = path.join('.vscode', 'web-boot.json');

export class PreferenceStore {
  private cache: MesBootConfig = {};
  private loaded = false;

  constructor(private readonly root: string) {}

  get filePath(): string {
    return path.join(this.root, FILE_REL);
  }

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const text = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(text) as MesBootConfig;
      this.cache = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      this.cache = {};
    }
  }

  get(appId: string): AppPreference {
    this.ensureLoaded();
    return this.cache.apps?.[appId] ?? {};
  }

  /** 写入某个应用的偏好（合并式更新） */
  async set(appId: string, patch: AppPreference): Promise<void> {
    this.ensureLoaded();
    const apps = this.cache.apps ?? {};
    apps[appId] = { ...apps[appId], ...patch };
    this.cache.apps = apps;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, `${JSON.stringify(this.cache, null, 2)}\n`, 'utf8');
    } catch {
      // 写入失败不阻断启动流程
    }
  }
}
