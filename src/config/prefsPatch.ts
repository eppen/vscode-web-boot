/**
 * 参数面板的「一整行表单输入 -> AppPreference 补丁」纯逻辑。
 *
 * 写盘语义刻意与单应用编辑（extension.ts 的 editPreferences）保持一致：
 * - 端口留空、或等于该 profile 在配置文件里的端口 -> 不写覆盖；
 * - 主类留空、或等于扫描到的启动类 -> 不写覆盖；
 * - `-am` / 覆盖率是「三态」：undefined 表示跟随全局设置（JSON 里不落字段）；
 * - 换 profile 时旧 profile 的端口覆盖不再适用，一并清掉。
 *
 * 不依赖 vscode，可以在 selfcheck 里直接跑。
 */
import type { AppPreference } from '../model/types';
import { isJavaFqn, isValidPort } from '../util/validate';

/** 面板上某一行编辑后的原始输入（都是用户看得见的字面值） */
export interface RawRowInput {
  /** 记住的 profile；空串表示跟随 application.yml 里的默认 profile */
  profile?: string;
  /** 端口原文；空串表示跟随配置文件里的端口 */
  port?: string;
  /** 主类原文；空串表示跟随扫描到的启动类 */
  mainClass?: string;
  /** 三态：undefined 表示跟随全局设置 */
  buildDependencies?: boolean;
  /** 三态：undefined 表示跟随全局设置 */
  coverage?: boolean;
}

/** 校验失败的字段（调用方负责翻成当前语言的提示） */
export type InvalidField = 'profile' | 'port' | 'mainClass';

export interface DiffInput {
  /** 扫描到的主类（输入等于它时不写覆盖） */
  scannedMainClass: string;
  /** 新 profile 在配置文件里的端口（输入等于它时不写覆盖） */
  configPort: number;
  /** 切换前该应用的生效端口（换 profile 时判断「用户是否显式改了端口」） */
  previousPort: number;
  /** 该应用可选的 profile；为空表示无从校验，直接接受输入 */
  availableProfiles: string[];
  /** 当前已存偏好（基线） */
  current: AppPreference;
  /** 面板输入 */
  next: RawRowInput;
}

export interface DiffResult {
  /** 合并进 store 的补丁：五个字段一定都出现（undefined 表示清掉该字段） */
  patch: AppPreference;
  /** 与基线相比是否有变化 */
  changed: boolean;
  /** 有值表示该行被跳过，patch 不可用 */
  invalid?: InvalidField;
}

/** 偏好是否完全一致（按五个已知字段比较） */
export function samePreference(a: AppPreference, b: AppPreference): boolean {
  return (
    a.profile === b.profile &&
    a.port === b.port &&
    a.mainClass === b.mainClass &&
    a.buildDependencies === b.buildDependencies &&
    a.coverage === b.coverage
  );
}

/** 计算一行输入对应的偏好补丁 */
export function diffPreference(input: DiffInput): DiffResult {
  const { current, next, configPort, previousPort, scannedMainClass, availableProfiles } = input;

  const profileText = (next.profile ?? '').trim();
  const portText = (next.port ?? '').trim();
  const mainText = (next.mainClass ?? '').trim();

  // profile 要么留空（跟随 yml 默认），要么必须是该应用已有的 profile
  if (profileText && availableProfiles.length > 0 && !availableProfiles.includes(profileText)) {
    return { patch: {}, changed: false, invalid: 'profile' };
  }
  const profile = profileText || undefined;

  // 端口：留空 / 等于配置文件端口 -> 不写覆盖
  let port: number | undefined;
  if (portText) {
    const parsed = Number(portText);
    if (!isValidPort(parsed)) {
      return { patch: {}, changed: false, invalid: 'port' };
    }
    port = parsed === configPort ? undefined : parsed;
  }

  // 换 profile 时旧覆盖不再适用：除非用户把端口改成了别的值，否则一律清掉
  if (profile !== current.profile && (port === undefined || port === previousPort)) {
    port = undefined;
  }

  // 主类：留空 / 等于扫描值 -> 不写覆盖
  let mainClass: string | undefined;
  if (mainText) {
    if (!isJavaFqn(mainText)) {
      return { patch: {}, changed: false, invalid: 'mainClass' };
    }
    mainClass = mainText === scannedMainClass ? undefined : mainText;
  }

  const patch: AppPreference = {
    profile,
    port,
    mainClass,
    buildDependencies:
      typeof next.buildDependencies === 'boolean' ? next.buildDependencies : undefined,
    coverage: typeof next.coverage === 'boolean' ? next.coverage : undefined
  };

  return { patch, changed: !samePreference(patch, current) };
}
