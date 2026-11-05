/**
 * 构造 mvn 命令。
 *
 * 两条分支：
 * 1. reactor 内：`mvn -pl :artifactId -am ... spring-boot:run`
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

export function buildCommandPlan(spec: LaunchSpec, opts: BuildOptions): CommandPlan {
  const { app } = spec;
  const mvn = opts.mavenCommand || 'mvn';

  const selector = app.inReactor
    ? ['-pl', `:${app.id.split('#')[0]}`, '-am']
    : // 统一用正斜杠：Windows cmd 与 bash 都接受，便于复制命令到任意终端
      ['-f', `${app.relDir}/pom.xml`];

  const common = ['-B', ...selector, '-DskipTests'];

  const plan: CommandPlan = {
    run: [],
    runLine: ''
  };

  if (opts.preBuild !== 'none') {
    const pre = [mvn, ...common, opts.preBuild];
    plan.preBuild = pre;
    plan.preBuildLine = renderCommand(pre);
  }

  const run = [mvn, ...common, 'spring-boot:run'];
  if (spec.profile) {
    run.push(`-Dspring-boot.run.profiles=${spec.profile}`);
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

/** 计算访问地址 */
export function buildUrl(port: number | undefined, contextPath: string | undefined): string | undefined {
  if (!port) {
    return undefined;
  }
  const ctx = contextPath && contextPath !== '/' ? contextPath : '';
  const normalized = ctx && !ctx.startsWith('/') ? `/${ctx}` : ctx;
  return `http://localhost:${port}${normalized}`;
}
