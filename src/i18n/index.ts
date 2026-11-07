/**
 * 轻量 i18n：中日英三语。
 *
 * - 词典以 key 组织，zh-cn 是 key 的唯一来源；en / ja 用 Record<MessageKey, string> 约束完整性。
 * - 语言按 `webBoot.language` 决定：auto 跟随 VS Code 显示语言，其余强制指定。
 * - 本模块刻意不 import vscode：portProcess / processManager / coverage 等纯逻辑文件
 *   也会引用 t()，而它们要在没有 vscode 宿主的自检脚本里运行。
 *   语言由 extension.ts 在 activate 时通过 initI18n() 注入。
 */
import { zhCN, type MessageKey } from './locales/zh-cn';
import { en } from './locales/en';
import { ja } from './locales/ja';

export type Locale = 'zh-cn' | 'en' | 'ja';
export type { MessageKey };

/** 语言偏好：auto 表示跟随编辑器显示语言 */
export type LanguagePreference = 'auto' | Locale;

const BUNDLES: Record<Locale, Record<MessageKey, string>> = {
  'zh-cn': zhCN,
  en,
  ja
};

/** 未初始化时的默认语言（与扩展历史行为一致：中文） */
let activeLocale: Locale = 'zh-cn';

/** 把任意写法归一化为受支持的 locale；auto / 空值返回 undefined */
export function normalizeLocale(value: string | undefined): Locale | undefined {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw || raw === 'auto') {
    return undefined;
  }
  if (raw.startsWith('zh')) {
    return 'zh-cn';
  }
  if (raw.startsWith('ja')) {
    return 'ja';
  }
  if (raw.startsWith('en')) {
    return 'en';
  }
  return undefined;
}

/**
 * 解析生效语言：
 * 1. 显式偏好（zh-cn / en / ja）优先；
 * 2. 否则跟随 VS Code 显示语言（zh* -> zh-cn，ja* -> ja，其余回落英文）。
 */
export function resolveLocale(
  displayLanguage: string | undefined,
  preference: string | undefined
): Locale {
  return normalizeLocale(preference) ?? normalizeLocale(displayLanguage) ?? 'en';
}

/** 初始化当前语言 */
export function initI18n(
  displayLanguage: string | undefined,
  preference: string | undefined
): Locale {
  activeLocale = resolveLocale(displayLanguage, preference);
  return activeLocale;
}

export function getLocale(): Locale {
  return activeLocale;
}

/** 按位置参数替换 {0} {1} … */
export function formatMessage(template: string, args: Array<string | number>): string {
  if (args.length === 0) {
    return template;
  }
  return template.replace(/\{(\d+)\}/g, (matched, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? matched : String(value);
  });
}

/** 取当前语言的文案；缺失时回落到中文，再回落到 key 本身 */
export function t(key: MessageKey, ...args: Array<string | number>): string {
  const bundle = BUNDLES[activeLocale] ?? zhCN;
  const template = bundle[key] ?? zhCN[key] ?? key;
  return formatMessage(template, args);
}
