/**
 * 领域模型：一个可启动的 Spring Boot 应用，以及它的运行期状态。
 */

/** 应用运行状态 */
export type AppState = 'stopped' | 'starting' | 'running' | 'stopping';

/** 模块在 Maven reactor 中的信息 */
export interface MavenModule {
  /** 模块目录绝对路径 */
  dir: string;
  /** 相对工作区根目录的路径，正斜杠分隔 */
  relDir: string;
  artifactId: string;
  packaging: string;
}

/**
 * 从 application*.yml 解析出来的 Spring 配置。
 * 端口与 context-path 按 profile 分别给出「生效值」。
 */
export interface SpringConfig {
  /** spring.application.name */
  appName?: string;
  /** 基础 application.yml 中 spring.profiles.active 声明的 profile */
  baseProfiles: string[];
  /** 所有可用的 profile 名（来自 application-*.yml 文件名 + baseProfiles） */
  profiles: string[];
  /** profile -> 生效端口（已合并 base 与 profile 覆盖） */
  ports: Record<string, number>;
  /** profile -> 生效 context-path（已合并 base 与 profile 覆盖） */
  contextPaths: Record<string, string>;
  /** 基础配置里的 context-path，用于无 profile 场景 */
  baseContextPath: string;
  /** 解析所用的 resources 目录，便于排错 */
  resourcesDir?: string;
}

/** 一个可启动的 Spring Boot 应用 */
export interface BootApp {
  /** 唯一标识，通常等于 artifactId */
  id: string;
  /** 模块目录绝对路径 */
  dir: string;
  /** 相对工作区根目录的路径 */
  relDir: string;
  /** 启动类全限定名 */
  mainClass: string;
  /** 启动类文件绝对路径 */
  mainClassFile: string;
  /** 是否属于根 reactor（false 表示需要用 -f 单独启动） */
  inReactor: boolean;
  /** 说明为何不在 reactor 内，用于提示 */
  reactorNote?: string;
  /** pom packaging */
  packaging: string;
  /** Spring 配置 */
  config: SpringConfig;
}

/** 每个应用的运行期状态 */
export interface AppRuntime {
  state: AppState;
  profile?: string;
  /** 实际监听端口 */
  port?: number;
  contextPath?: string;
  debugPort?: number;
  debug: boolean;
  pid?: number;
  startedAt?: number;
  /** 最近一次启动的完整命令，便于排错与复制 */
  lastCommand?: string;
}

/** 每个应用持久化的偏好（.vscode/web-boot.json） */
export interface AppPreference {
  profile?: string;
  port?: number;
  /** 覆盖扫描到的主类；写入 spring-boot.run.main-class */
  mainClass?: string;
}

/** 手动分组：应用 id 最多属于一个分组 */
export interface AppGroup {
  name: string;
  apps: string[];
}

export interface MesBootConfig {
  apps?: Record<string, AppPreference>;
  /** 分组按数组顺序展示 */
  groups?: AppGroup[];
}

/** 一次启动请求 */
export interface LaunchSpec {
  app: BootApp;
  profile: string;
  /** 覆盖端口；undefined 表示用 profile 对应配置里的端口 */
  port?: number;
  /** 实际启动的主类；有值时传给 spring-boot.run.main-class */
  mainClass?: string;
  debug: boolean;
  debugPort?: number;
}
