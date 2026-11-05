/**
 * 个人偏好存储：.vscode/web-boot.json
 *
 * 放在 .vscode/ 下，因为本仓库 .gitignore 已忽略该目录，
 * 属于「本机个人配置」，不会误提交。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { AppGroup, AppPreference, MesBootConfig } from '../model/types';

const FILE_REL = path.join('.vscode', 'web-boot.json');

/** 清洗分组配置：丢弃非法项，保证一个应用最多属于一个分组 */
function normalizeGroups(raw: unknown): AppGroup[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const groups: AppGroup[] = [];
  const seenApps = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const name =
      typeof (entry as { name?: unknown }).name === 'string'
        ? (entry as { name: string }).name.trim()
        : '';
    if (!name || groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      continue;
    }
    const rawApps = (entry as { apps?: unknown }).apps;
    const apps: string[] = [];
    if (Array.isArray(rawApps)) {
      for (const id of rawApps) {
        if (typeof id === 'string' && id && !seenApps.has(id)) {
          seenApps.add(id);
          apps.push(id);
        }
      }
    }
    groups.push({ name, apps });
  }
  return groups;
}

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
    this.cache.groups = normalizeGroups(this.cache.groups);
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
    this.persist();
  }

  getGroups(): AppGroup[] {
    this.ensureLoaded();
    return (this.cache.groups ?? []).map((g) => ({ name: g.name, apps: [...g.apps] }));
  }

  /** 应用当前所属分组名 */
  groupOf(appId: string): string | undefined {
    return this.getGroups().find((g) => g.apps.includes(appId))?.name;
  }

  async createGroup(name: string): Promise<void> {
    await this.setGroups([...this.getGroups(), { name, apps: [] }]);
  }

  async renameGroup(oldName: string, newName: string): Promise<void> {
    const groups = this.getGroups();
    const group = groups.find((g) => g.name === oldName);
    if (!group) {
      return;
    }
    group.name = newName;
    await this.setGroups(groups);
  }

  async deleteGroup(name: string): Promise<void> {
    await this.setGroups(this.getGroups().filter((g) => g.name !== name));
  }

  /**
   * 把应用移入目标分组；target 为 undefined 表示移出分组。
   * 应用在分组间移动时会先从旧分组移除。
   */
  async assignApps(appIds: string[], target: string | undefined): Promise<void> {
    if (appIds.length === 0) {
      return;
    }
    const ids = new Set(appIds);
    const groups = this.getGroups().map((g) => ({
      name: g.name,
      apps: g.apps.filter((id) => !ids.has(id))
    }));
    if (target) {
      const group = groups.find((g) => g.name === target);
      if (group) {
        for (const id of appIds) {
          if (!group.apps.includes(id)) {
            group.apps.push(id);
          }
        }
      }
    }
    await this.setGroups(groups);
  }

  private async setGroups(groups: AppGroup[]): Promise<void> {
    this.ensureLoaded();
    this.cache.groups = groups;
    this.persist();
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, `${JSON.stringify(this.cache, null, 2)}\n`, 'utf8');
    } catch {
      // 写入失败不阻断操作
    }
  }
}
