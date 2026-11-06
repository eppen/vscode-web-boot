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

/** JVM 堆与 GC 指标（来自 jstat -gc） */
export interface JvmMetrics {
  /** 已用堆（KB） */
  heapUsedK?: number;
  /** 已提交堆（KB） */
  heapCommittedK?: number;
  /** 已用 / 已提交 */
  heapUsedPercent?: number;
  /** 年轻代 GC 次数与耗时（秒） */
  ygc?: number;
  ygct?: number;
  /** Full GC 次数与耗时（秒） */
  fgc?: number;
  fgct?: number;
  /** GC 总耗时（秒） */
  gct?: number;
}

/** Tomcat 探活与线程池指标（线程池来自 Actuator，未启用时为空） */
export interface TomcatMetrics {
  /** 根路径有响应即视为存活 */
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  /** actuator/metrics/tomcat.threads.busy */
  busyThreads?: number;
  /** actuator/metrics/tomcat.threads.config.max */
  maxThreads?: number;
}

/** 启动成功后的实时监控快照 */
export interface AppMetrics {
  jvm?: JvmMetrics;
  /** jstat / jps 不可用或未找到 Java 进程时的说明 */
  jvmError?: string;
  tomcat?: TomcatMetrics;
  updatedAt: number;
}

/** 一类 JaCoCo 计数器（行 / 分支 / 类）的命中情况 */
export interface CoverageCounter {
  covered: number;
  missed: number;
  /** 命中率（0-100）；总数为 0 时为 undefined，避免显示 NaN */
  rate?: number;
}

/** 一次 JaCoCo 报告的关键指标（来自 report.xml） */
export interface CoverageSummary {
  line: CoverageCounter;
  branch: CoverageCounter;
  /** 类覆盖率（JaCoCo 的 counter type=CLASS） */
  clazz: CoverageCounter;
  /** 生成报告的时间 */
  updatedAt: number;
}

/** 单个应用的运行时覆盖率状态 */
export interface CoverageState {
  /** 本次启动是否挂了 JaCoCo agent */
  enabled: boolean;
  /** agent 的 tcpserver 端口（dump 时连这个端口） */
  port?: number;
  /** 累积的 exec 文件（多次 dump 合并后的结果） */
  execFile?: string;
  /** HTML 报告目录 */
  reportDir?: string;
  /** XML 报告路径（解析指标用） */
  xmlFile?: string;
  summary?: CoverageSummary;
  /** 最近一次失败原因（不影响应用运行） */
  error?: string;
  updatedAt?: number;
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
  /** 启动后的 JVM / Tomcat 监控快照 */
  metrics?: AppMetrics;
  /** 运行时覆盖率状态（未启用时为 undefined） */
  coverage?: CoverageState;
}

/** 每个应用持久化的偏好（.vscode/web-boot.json） */
export interface AppPreference {
  profile?: string;
  port?: number;
  /** 覆盖扫描到的主类；写入 spring-boot.run.main-class */
  mainClass?: string;
  /** 覆盖 webBoot.buildDependencies；undefined 表示跟随全局设置 */
  buildDependencies?: boolean;
  /** 覆盖 webBoot.coverage（是否挂 JaCoCo agent）；undefined 表示跟随全局设置 */
  coverage?: boolean;
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
  /** 实际生效的 -am 开关；undefined 表示跟随 webBoot.buildDependencies */
  buildDependencies?: boolean;
  /** 是否启用运行时覆盖率（挂 JaCoCo agent）；undefined 表示跟随 webBoot.coverage */
  coverage?: boolean;
  /** 实际注入的 agent 参数；由启动器确认工具就绪后填入 */
  coverageAgent?: CoverageAgentSpec;
  debug: boolean;
  debugPort?: number;
}

/** 注入 JVM 的 JaCoCo agent 细节（jar 路径 + tcpserver 端口） */
export interface CoverageAgentSpec {
  /** org.jacoco.agent-<version>-runtime.jar 的绝对路径 */
  jar: string;
  /** tcpserver 监听端口 */
  port: number;
  /** sessionid，便于在 exec 里区分应用 */
  sessionId?: string;
}
