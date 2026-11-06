/**
 * 运行时覆盖率（JaCoCo）。
 *
 * 为什么必须显式 dump：
 * Windows 下停止应用走 `taskkill /T /F`（见 processManager.ts），是强制终止，
 * JVM 不会执行 shutdown hook，JaCoCo 的 `dumponexit` 拿不到任何数据。
 * 所以 agent 用 `output=tcpserver`，停止前先连端口 dump 出 .exec，再杀进程；
 * 多次启动/采样得到的 exec 用 jacococli merge 累积，最后生成 HTML + XML 报告。
 *
 * 本文件只放「纯函数 + 文件操作」，不引用 vscode，便于 test/coverage.ts 直接断言参数。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CoverageCounter, CoverageSummary } from '../model/types';
import { execText, firstLines } from '../util/jdk';

/** JaCoCo 默认版本（0.8.13，2025-04 发布；支持到 Java 24 的 class 文件） */
export const DEFAULT_JACOCO_VERSION = '0.8.13';

const MSG_PREFIX = '[覆盖率]';

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function fileExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * 是否启用了覆盖率（按应用偏好在单元格里单独计算）。
 * 单独抽出来便于测试「应用偏好 > 全局设置」的优先级。
 */
export function resolveCoverageEnabled(
  globalEnabled: boolean | undefined,
  appEnabled: boolean | undefined
): boolean {
  if (appEnabled !== undefined) {
    return appEnabled;
  }
  return globalEnabled === true;
}

export interface AgentOptions {
  /** org.jacoco.agent-<v>-runtime.jar 绝对路径 */
  jar: string;
  /** tcpserver 端口 */
  port: number;
  /** 只统计这些包/类（JaCoCo 的 includes 语法，如 `com.example.*`） */
  includes?: string[];
  /** 会话标识，默认 webboot；写进 sessionid 便于在 exec 里区分应用 */
  sessionId?: string;
}

/**
 * 生成 `-javaagent` 参数（tcpserver 模式，不依赖 JVM 退出时写文件）。
 * jar 路径含空格时加引号：spring-boot-maven-plugin 用 translateCommandline 解析
 * jvmArguments，能正确处理成对引号。
 */
export function buildJacocoAgentArg(opts: AgentOptions): string {
  const jar =
    opts.jar.includes(' ') || opts.jar.includes('"')
      ? `"${opts.jar.replace(/"/g, '')}"`
      : opts.jar;
  const parts = [
    'output=tcpserver',
    'address=127.0.0.1',
    `port=${opts.port}`,
    'dumponexit=false',
    `sessionid=${(opts.sessionId ?? 'webboot').replace(/[,=]/g, '_')}`
  ];
  const includes = (opts.includes ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
  if (includes.length > 0) {
    parts.push(`includes=${includes.join(':')}`);
  }
  return `-javaagent:${jar}=${parts.join(',')}`;
}

export interface DumpOptions {
  /** org.jacoco.cli-<v>-nodeps.jar 绝对路径 */
  cliJar: string;
  /** agent 的 tcpserver 端口 */
  port: number;
  /** 输出 exec 文件路径 */
  dest: string;
  /** agent 监听地址，默认 127.0.0.1 */
  address?: string;
}

/** jacococli dump 的 argv（不含 java 可执行文件，调用方自己前面加 java） */
export function buildDumpArgs(opts: DumpOptions): string[] {
  return [
    '-jar',
    opts.cliJar,
    'dump',
    '--address',
    opts.address ?? '127.0.0.1',
    '--port',
    String(opts.port),
    '--destfile',
    opts.dest
  ];
}

export interface MergeOptions {
  cliJar: string;
  /** 待合并的 exec 文件；至少 1 个 */
  files: string[];
  /** 合并结果 */
  dest: string;
}

/** jacococli merge 的 argv */
export function buildMergeArgs(opts: MergeOptions): string[] {
  return ['-jar', opts.cliJar, 'merge', ...opts.files, '--destfile', opts.dest];
}

export interface ReportOptions {
  cliJar: string;
  /** 合并后的 exec 文件 */
  exec: string;
  /** 字节码目录，多模块时逐个给出（通常是各模块 target/classes） */
  classfiles: string[];
  /** 源码目录，用于 HTML 里显示源码高亮 */
  sourcefiles: string[];
  /** HTML 报告输出目录 */
  htmlDir: string;
  /** XML 报告路径，供 parseJacocoXml 解析 */
  xmlFile: string;
  /** 报告标题 */
  name?: string;
}

/** jacococli report 的 argv：同时产出 HTML 与 XML */
export function buildReportArgs(opts: ReportOptions): string[] {
  const args = ['-jar', opts.cliJar, 'report', opts.exec];
  if (opts.classfiles.length > 0) {
    args.push('--classfiles', ...opts.classfiles);
  }
  if (opts.sourcefiles.length > 0) {
    args.push('--sourcefiles', ...opts.sourcefiles);
  }
  args.push('--html', opts.htmlDir, '--xml', opts.xmlFile);
  if (opts.name) {
    args.push('--name', opts.name);
  }
  return args;
}

function toCounter(covered: number, missed: number): CoverageCounter {
  const total = covered + missed;
  return {
    covered,
    missed,
    rate: total > 0 ? (covered / total) * 100 : undefined
  };
}

const EMPTY_COUNTER: CoverageCounter = { covered: 0, missed: 0, rate: undefined };

/** 只剥离注释，避免注释里出现伪标签 */
function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
}

/** 会形成层级、影响 counter 归属的元素（其余如 line/counter 是自闭合的） */
const CONTAINER_TAGS = new Set([
  'report',
  'group',
  'package',
  'class',
  'sourcefile',
  'method',
  'sessioninfo'
]);

function parseCounterAttrs(attrs: string): { type: string; covered: number; missed: number } | undefined {
  const type = /\btype="([^"]*)"/.exec(attrs)?.[1];
  const coveredRaw = /\bcovered="(\d+)"/.exec(attrs)?.[1];
  const missedRaw = /\bmissed="(\d+)"/.exec(attrs)?.[1];
  if (!type || coveredRaw === undefined || missedRaw === undefined) {
    return undefined;
  }
  return { type, covered: Number(coveredRaw), missed: Number(missedRaw) };
}

/**
 * 解析 JaCoCo `report.xml`，取 <report> 直属的 counter（报告级汇总）。
 * 缺计数器或格式不认识时降级为 0 命中，绝不抛错——覆盖率只是附加信息，
 * 不能因为报告格式变化就让整个扩展报错。
 */
export function parseJacocoXml(xmlText: string): CoverageSummary {
  const summary: CoverageSummary = {
    line: EMPTY_COUNTER,
    branch: EMPTY_COUNTER,
    clazz: EMPTY_COUNTER,
    updatedAt: Date.now()
  };
  if (!xmlText || !xmlText.trim()) {
    return summary;
  }

  const xml = stripComments(xmlText);
  const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(xml)) !== null) {
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrs = match[3] ?? '';
    const selfClosing = match[4] === '/';

    if (!CONTAINER_TAGS.has(tag)) {
      // 报告级 counter 是 <report> 的直属子节点：report 开标签后 depth 为 1
      if (tag === 'counter' && depth === 1) {
        const counter = parseCounterAttrs(attrs);
        if (counter) {
          const parsed = toCounter(counter.covered, counter.missed);
          if (counter.type === 'LINE') {
            summary.line = parsed;
          } else if (counter.type === 'BRANCH') {
            summary.branch = parsed;
          } else if (counter.type === 'CLASS') {
            summary.clazz = parsed;
          }
        }
      }
      continue;
    }

    if (closing) {
      depth = Math.max(0, depth - 1);
    } else if (!selfClosing) {
      depth++;
    }
  }
  return summary;
}

/** exec / 报告目录：.vscode/web-boot/coverage/<appId> */
export function coverageDir(root: string, appId: string): string {
  const safe = appId.replace(/[\\/:*?"<>|#]/g, '_');
  return path.join(root, '.vscode', 'web-boot', 'coverage', safe);
}

/** 工具 jar 缓存目录：.vscode/web-boot/jacoco/<version> */
export function toolsCacheDir(root: string, version: string): string {
  return path.join(root, '.vscode', 'web-boot', 'jacoco', version);
}

/**
 * 读取 Maven 本地仓库路径（settings.localRepository）。
 * 失败（离线、老 Maven、settings 有代理问题）时回退 ~/.m2/repository。
 */
export async function resolveLocalRepo(mvn: string, cwd: string): Promise<string> {
  const fallback = path.join(os.homedir(), '.m2', 'repository');
  try {
    const out = await execText(
      mvn,
      [
        '-B',
        'help:evaluate',
        '-Dexpression=settings.localRepository',
        '-q',
        '-DforceStdout'
      ],
      60_000,
      cwd
    );
    const line = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .pop();
    if (line && /^[A-Za-z]:[\\/]|^\//.test(line)) {
      return line;
    }
  } catch {
    // 忽略：回退默认路径
  }
  return fallback;
}

export interface JacocoTools {
  version: string;
  /** 挂到 JVM 上的 agent jar */
  agentJar: string;
  /** jacococli（dump / merge / report） */
  cliJar: string;
}

export interface EnsureToolsOptions {
  mvn: string;
  version: string;
  /** jar 副本存放目录（工作区内，避免每次去 ~/.m2 找） */
  cacheDir: string;
  /** 执行 mvn 的工作目录 */
  cwd: string;
  /** 输出日志回调 */
  log?: (line: string) => void;
}

function agentJarName(version: string): string {
  return `org.jacoco.agent-${version}-runtime.jar`;
}

function cliJarName(version: string): string {
  return `org.jacoco.cli-${version}-nodeps.jar`;
}

/**
 * 准备 JaCoCo 工具：本地仓库 / 缓存目录有就直接用，缺的先 dependency:get 再复制到缓存目录。
 * 注意必须有 `runtime` classifier 的 agent jar 才能当 -javaagent 用。
 */
export async function ensureJacocoTools(opts: EnsureToolsOptions): Promise<JacocoTools> {
  const log = opts.log ?? (() => undefined);
  ensureDir(opts.cacheDir);
  const agentJar = path.join(opts.cacheDir, agentJarName(opts.version));
  const cliJar = path.join(opts.cacheDir, cliJarName(opts.version));
  if (fileExists(agentJar) && fileExists(cliJar)) {
    return { version: opts.version, agentJar, cliJar };
  }

  const repo = await resolveLocalRepo(opts.mvn, opts.cwd);
  const repoAgent = path.join(
    repo,
    'org',
    'jacoco',
    'org.jacoco.agent',
    opts.version,
    agentJarName(opts.version)
  );
  const repoCli = path.join(
    repo,
    'org',
    'jacoco',
    'org.jacoco.cli',
    opts.version,
    cliJarName(opts.version)
  );

  const tasks: Array<{ target: string; source: string; artifact: string }> = [];
  if (!fileExists(agentJar)) {
    tasks.push({
      target: agentJar,
      source: repoAgent,
      artifact: `org.jacoco:org.jacoco.agent:${opts.version}:jar:runtime`
    });
  }
  if (!fileExists(cliJar)) {
    tasks.push({
      target: cliJar,
      source: repoCli,
      artifact: `org.jacoco:org.jacoco.cli:${opts.version}:jar:nodeps`
    });
  }

  for (const task of tasks) {
    if (!fileExists(task.source)) {
      log(`${MSG_PREFIX} 本地仓库缺少 ${task.artifact}，执行 mvn dependency:get 下载...`);
      try {
        await execText(
          opts.mvn,
          [
            '-B',
            '-q',
            'dependency:get',
            `-Dartifact=${task.artifact}`,
            '-Dtransitive=false'
          ],
          180_000,
          opts.cwd
        );
      } catch (err) {
        throw new Error(
          `下载 ${task.artifact} 失败：${firstLines(err instanceof Error ? err.message : String(err))}`
        );
      }
    }
    if (!fileExists(task.source)) {
      throw new Error(`未找到 ${task.artifact}（检查 Maven 本地仓库 ${repo}）`);
    }
    fs.copyFileSync(task.source, task.target);
    log(`${MSG_PREFIX} 已准备 ${path.basename(task.target)}`);
  }

  return { version: opts.version, agentJar, cliJar };
}
