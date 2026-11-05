/**
 * 解析模块的 Spring 配置：profile 列表、端口、context-path。
 *
 * 本仓库的特点：mes-web 一个模块就有 11 个 application-*.yml，
 * 且端口在 profile 层被覆盖（eos2/dev/eos3 -> 8082，其余 -> 8080）。
 * 因此这里必须按「base yml + profile yml 覆盖」算出每个 profile 的生效值，
 * 而不是只读 application.yml。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { SpringConfig } from '../model/types';

const DEFAULT_PORT = 8080;

type Json = Record<string, unknown>;

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * 解析 yml / yaml / properties 文件，失败返回 undefined（不阻断扫描）。
 *
 * yml 必须用 parseAllDocuments：本仓库 mes-agentscope 的 application.yml
 * 里用 `---` 分裂成多文档，单文档解析会直接抛
 * "Source contains multiple documents"，导致端口退化到 8080。
 */
function loadConfigFile(file: string): Json | undefined {
  const text = readText(file);
  if (text === undefined) {
    return undefined;
  }
  if (file.endsWith('.properties')) {
    return parseProperties(text);
  }
  try {
    const docs = YAML.parseAllDocuments(text);
    // 取第一个文档作为主配置；profile 由文件名区分，不混入后续文档
    const first = docs[0]?.toJS();
    return first && typeof first === 'object' ? (first as Json) : undefined;
  } catch {
    return undefined;
  }
}

/** 展开 key=a.b.c 形式为嵌套对象，便于复用 get() */
function parseProperties(text: string): Json {
  const root: Json = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    const eq = line.indexOf('=');
    const colon = line.indexOf(':');
    let sep = eq;
    if (sep < 0 || (colon >= 0 && colon < sep)) {
      sep = colon;
    }
    if (sep <= 0) {
      continue;
    }
    const key = line.substring(0, sep).trim();
    const value = line.substring(sep + 1).trim();
    if (!key) {
      continue;
    }
    let cursor = root;
    const parts = key.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!isObject(cursor[part])) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Json;
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return root;
}

/** 按路径取值，如 get(doc, ['server','port']) */
function get(node: unknown, keys: string[]): unknown {
  let cur: unknown = node;
  for (const key of keys) {
    if (!cur || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Json)[key];
  }
  return cur;
}

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 深合并：override 覆盖 base */
function deepMerge(base: Json | undefined, override: Json | undefined): Json {
  if (!base) {
    return override ? { ...override } : {};
  }
  if (!override) {
    return { ...base };
  }
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (isObject(v) && isObject(out[k])) {
      out[k] = deepMerge(out[k] as Json, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * 处理 `8082` 与 `${SERVER_PORT:8082}` 两种写法。
 * 占位符只取默认值部分；取不到默认值时返回 undefined。
 */
function toPortString(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  let raw = value.trim();
  const placeholder = raw.match(/^\$\{[^:}]+:([^}]*)\}$/);
  if (placeholder) {
    raw = placeholder[1].trim();
  } else if (raw.includes('${')) {
    return undefined;
  }
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

/** 取 spring.profiles.active，兼容字符串与数组 */
function toProfiles(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  return [];
}

/** 读取一个模块的 Spring 配置 */
export function readSpringConfig(moduleDir: string): SpringConfig {
  const resourcesDir = path.join(moduleDir, 'src', 'main', 'resources');
  const baseFile = ['application.yml', 'application.yaml', 'application.properties']
    .map((f) => path.join(resourcesDir, f))
    .find((f) => fs.existsSync(f));

  const baseDoc = baseFile ? loadConfigFile(baseFile) : undefined;

  const baseProfiles = toProfiles(get(baseDoc, ['spring', 'profiles', 'active']));
  const basePort = toPortString(get(baseDoc, ['server', 'port'])) ?? DEFAULT_PORT;
  const baseContextPath = toStringValue(get(baseDoc, ['server', 'servlet', 'context-path'])) ?? '';
  const appName = toStringValue(get(baseDoc, ['spring', 'application', 'name']));

  // 收集 application-<profile>.yml
  const profiledFiles = new Map<string, string>();
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(resourcesDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const m = entry.name.match(/^application-(.+)\.(yml|yaml|properties)$/);
    if (m) {
      profiledFiles.set(m[1], path.join(resourcesDir, entry.name));
    }
  }

  const profiles = new Set<string>(baseProfiles);
  for (const name of profiledFiles.keys()) {
    profiles.add(name);
  }

  const ports: Record<string, number> = {};
  const contextPaths: Record<string, string> = {};

  // 无 profile 场景（也不在 baseProfiles 里）用 base 值兜底
  ports[''] = basePort;
  contextPaths[''] = baseContextPath;

  for (const [profile, file] of profiledFiles) {
    const profileDoc = loadConfigFile(file);
    const merged = deepMerge(baseDoc, profileDoc);
    ports[profile] = toPortString(get(merged, ['server', 'port'])) ?? DEFAULT_PORT;
    contextPaths[profile] =
      toStringValue(get(merged, ['server', 'servlet', 'context-path'])) ?? baseContextPath;
  }
  for (const profile of baseProfiles) {
    if (ports[profile] === undefined) {
      ports[profile] = basePort;
      contextPaths[profile] = baseContextPath;
    }
  }

  return {
    appName,
    baseProfiles,
    profiles: Array.from(profiles).sort(),
    ports,
    contextPaths,
    baseContextPath,
    resourcesDir: fs.existsSync(resourcesDir) ? resourcesDir : undefined
  };
}

/** 取某 profile 的生效端口；未声明时回落到 base 端口 */
export function resolvePort(config: SpringConfig, profile: string): number {
  return config.ports[profile] ?? config.ports[''] ?? DEFAULT_PORT;
}

/** 取某 profile 的生效 context-path */
export function resolveContextPath(config: SpringConfig, profile: string): string {
  return config.contextPaths[profile] ?? config.baseContextPath ?? '';
}

/** 该应用的默认 profile：优先 base 声明的第一个，否则第一个可用 profile */
export function defaultProfile(config: SpringConfig): string {
  if (config.baseProfiles.length > 0) {
    return config.baseProfiles[0];
  }
  const candidates = config.profiles.filter((p) => p !== '');
  return candidates[0] ?? '';
}
