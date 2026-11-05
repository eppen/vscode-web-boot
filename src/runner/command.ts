/**
 * 构造 mvn 命令。
 *
 * 两条分支：
 * 1. reactor 内：`mvn -pl :artifactId [-am] ... spring-boot:run`
 *    `-am` 由 webBoot.buildDependencies 控制：开启时同时构建依赖模块，
 *    关闭时只构建目标模块，要求依赖已安装到本地仓库。
 * 2. reactor 外：`mvn -f <模块>/pom.xml ... spring-boot:run`
 *    （mes-monitor-server 与 mes-agentscope 就属于这一类，
 *      用 -pl 会报 "Could not find the selected project in the reactor"）
 */
import type { LaunchSpec } from '../model/types';

export interface CommandPlan {
  /** 预编译命令 argv（preBuild = none 时为 undefined） */
  preBuild?: string[];
  /** spring-boot:run 命令 argv */
  run: string[];
  /** 渲染后的完整 shell 命令，用于展示与复制 */
  runLine: string;
  /** 渲染后的预编译命令 */
  preBuildLine?: string;
}

/** 需要引号时用双引号包住（cmd 与 bash 都通用） */
function quoteArg(arg: string): string {
  if (arg === '') {
    return '""';
  }
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

export function renderCommand(argv: string[]): string {
  return argv.map(quoteArg).join(' ');
}

export interface BuildOptions {
  mavenCommand: string;
  preBuild: 'none' | 'compile' | 'package' | 'install';
  extraJvmArgs: string[];
  /** reactor 内是否追加 -am（同时构建依赖模块）；省略时视为 true */
  buildDependencies?: boolean;
}

/** 生成端口覆盖参数与 JVM 参数 */
function buildJvmArgs(spec: LaunchSpec, extra: string[]): string[] {
  const args = ['-Dspring.devtools.restart.enabled=false'];
  if (spec.debug && spec.debugPort) {
    // JDK 8/11/17 均支持 address=<port>；不要用 *:port（仅 JDK 9+）
    args.push(
      `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${spec.debugPort}`
    );
  }
  for (const e of extra) {
    if (e && e.trim()) {
      args.push(e.trim());
    }
  }
  return args;
}

/** 通用 Maven 参数：批处理、模块选择、跳过测试 */
function buildCommonArgs(spec: LaunchSpec, opts: BuildOptions): string[] {
  const { app } = spec;
  const moduleSelector = ['-pl', `:${app.id.split('#')[0]}`];
  const selector = app.inReactor
    ? opts.buildDependencies === false
      ? moduleSelector
      : [...moduleSelector, '-am']
    : // 统一用正斜杠：Windows cmd 与 bash 都接受，便于复制命令到任意终端
      ['-f', `${app.relDir}/pom.xml`];
  return ['-B', ...selector, '-DskipTests'];
}

export function buildCommandPlan(spec: LaunchSpec, opts: BuildOptions): CommandPlan {
  const mvn = opts.mavenCommand || 'mvn';
  const common = buildCommonArgs(spec, opts);

  const plan: CommandPlan = {
    run: [],
    runLine: ''
  };

  if (opts.preBuild !== 'none') {
    const pre = [mvn, ...common, opts.preBuild];
    plan.preBuild = pre;
    plan.preBuildLine = renderCommand(pre);
  }

  // mes-parent 根 pom 默认 <spring-boot.run.skip>true</spring-boot.run.skip>，
  // 命令行强制覆盖，保证 spring-boot:run 真正执行（不依赖各模块 pom 是否已覆盖）。
  // Maven 中 -D 用户属性优先级高于 pom <properties>，故此处一定生效。
  const run = [mvn, ...common, 'spring-boot:run', '-Dspring-boot.run.skip=false'];
  if (spec.profile) {
    run.push(`-Dspring-boot.run.profiles=${spec.profile}`);
  }
  if (spec.mainClass) {
    // 显式指定主类：模块里有多个 @SpringBootApplication 时避免插件报
    // "Unable to find a single main class"
    run.push(`-Dspring-boot.run.main-class=${spec.mainClass}`);
  }
  if (spec.port !== undefined) {
    run.push(`-Dspring-boot.run.arguments=--server.port=${spec.port}`);
  }
  const jvmArgs = buildJvmArgs(spec, opts.extraJvmArgs);
  if (jvmArgs.length > 0) {
    run.push(`-Dspring-boot.run.jvmArguments=${jvmArgs.join(' ')}`);
  }

  plan.run = run;
  plan.runLine = renderCommand(run);
  return plan;
}

/**
 * 对运行中的应用重新拷贝资源：mvn process-resources。
 * 模块选择与 -am 开关和启动命令保持一致。
 */
export function buildProcessResourcesCommand(spec: LaunchSpec, opts: BuildOptions): string {
  const mvn = opts.mavenCommand || 'mvn';
  return renderCommand([mvn, ...buildCommonArgs(spec, opts), 'process-resources']);
}

/** 计算访问地址 */
export function buildUrl(port: number | undefined, contextPath: string | undefined): string | undefined {
  if (!port) {
    return undefined;
  }
  const ctx = contextPath && contextPath !== '/' ? contextPath : '';
  const normalized = ctx && !ctx.startsWith('/') ? `/${ctx}` : ctx;
  return `http://localhost:${port}${normalized}`;
}
