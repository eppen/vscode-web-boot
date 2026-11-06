/**
 * 启动器：负责一条应用的完整生命周期（预编译 -> 启动 -> 就绪 -> 停止）。
 *
 * 之所以走 mvn spring-boot:run 而不是 java 直启：多模块项目的 classpath
 * 由 Maven 解析，天然正确；本仓库 mes-web/pom.xml 还特意开了
 * <useClasspathFile>true</useClasspathFile> 来解决 Windows classpath 过长
 * （error=206）。走 java 直启会重新踩这些坑。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AppRuntime, BootApp, CoverageAgentSpec, CoverageState, LaunchSpec } from '../model/types';
import { defaultProfile, resolveContextPath, resolvePort } from '../scanner/springConfig';
import { attachToApp } from '../debug/attach';
import { buildCommandPlan, buildProcessResourcesCommand, buildUrl } from './command';
import {
  DEFAULT_JACOCO_VERSION,
  buildDumpArgs,
  buildMergeArgs,
  buildReportArgs,
  coverageDir,
  ensureJacocoTools,
  parseJacocoXml,
  resolveCoverageEnabled,
  toolsCacheDir
} from './coverage';
import { parseBootLogLine } from './logParser';
import { MetricsMonitor } from './monitor';
import { spawnManaged, type ManagedProcess } from './processManager';
import { findFreePort } from '../util/ports';
import { execText, friendlyError, resolveJdkTool } from '../util/jdk';

const READY_TIMEOUT_MS = 240_000;
/** dump / merge / report 各自的超时：dump 要连 agent，report 要扫字节码 */
const DUMP_TIMEOUT_MS = 20_000;
const MERGE_TIMEOUT_MS = 60_000;
const REPORT_TIMEOUT_MS = 120_000;

/** 目录是否存在（避免把不存在的 classfiles 传给 jacococli） */
function existsDir(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** 覆盖率百分比展示：无数据时显示 -- */
function formatRate(rate: number | undefined): string {
  return rate === undefined ? '--' : `${rate.toFixed(1)}%`;
}

/** 一次运行期覆盖率所需的全部上下文（不进 AppRuntime，避免把路径塞进模型） */
interface CoverageContext {
  appId: string;
  port: number;
  cliJar: string;
  /** java 可执行文件（跑 jacococli 用） */
  java: string;
  /** 本应用的覆盖率工作目录 */
  dir: string;
  /** 累积的 exec：每次 dump 后 merge 进来 */
  execFile: string;
  htmlDir: string;
  xmlFile: string;
  classfiles: string[];
  sourcefiles: string[];
}

export class BootRunner implements vscode.Disposable {
  private readonly runtimes = new Map<string, AppRuntime>();
  private readonly processes = new Map<string, ManagedProcess>();
  /** 预编译阶段的子进程，便于「停止」时打断 */
  private readonly buildProcesses = new Map<string, ManagedProcess>();
  /** 已被用户取消启动的应用 */
  private readonly cancelled = new Set<string>();
  /** 正在执行 process-resources 的应用，避免重复触发 */
  private readonly resourcesRunning = new Set<string>();
  /** 覆盖率上下文：只有挂了 agent 的应用才有 */
  private readonly coverageContexts = new Map<string, CoverageContext>();
  /** 正在 dump / 出报告的应用，避免并发触发两次 jacococli */
  private readonly coverageBusy = new Set<string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly emitter = new vscode.EventEmitter<string>();
  private readonly monitor = new MetricsMonitor();

  /** 应用状态变化事件，参数为 appId */
  readonly onDidChangeState = this.emitter.event;

  constructor(
    private readonly root: string,
    private readonly output: vscode.OutputChannel
  ) {
    this.monitor.onDidUpdate(({ appId, metrics }) => this.update(appId, { metrics }));
  }

  getRuntime(appId: string): AppRuntime {
    let rt = this.runtimes.get(appId);
    if (!rt) {
      rt = { state: 'stopped', debug: false };
      this.runtimes.set(appId, rt);
    }
    return rt;
  }

  isBusy(appId: string): boolean {
    const state = this.getRuntime(appId).state;
    return state === 'starting' || state === 'running' || state === 'stopping';
  }

  private update(appId: string, patch: Partial<AppRuntime>): void {
    const rt = this.getRuntime(appId);
    this.runtimes.set(appId, { ...rt, ...patch });
    this.emitter.fire(appId);
  }

  private log(message: string): void {
    this.output.appendLine(message);
  }

  private logSection(title: string): void {
    this.output.appendLine('');
    this.output.appendLine(`===== ${title} =====`);
  }

  /** 运行一条命令并登记，便于 stop() 打断预编译 */
  private runTracked(appId: string, command: string, env: NodeJS.ProcessEnv): Promise<number> {
    return new Promise<number>((resolve) => {
      const proc = spawnManaged(command, {
        cwd: this.root,
        env,
        onLine: (line) => this.log(line),
        onExit: (code) => {
          this.buildProcesses.delete(appId);
          resolve(code ?? -1);
        }
      });
      this.buildProcesses.set(appId, proc);
    });
  }

  /** 启动一个应用；返回是否成功进入 running */
  async launch(app: BootApp, spec: LaunchSpec): Promise<boolean> {
    if (this.isBusy(app.id)) {
      void vscode.window.showWarningMessage(`${app.id} 正在运行或启动中，请先停止。`);
      return false;
    }
    this.cancelled.delete(app.id);

    const cfg = vscode.workspace.getConfiguration('webBoot');
    const mavenCommand = cfg.get<string>('mavenCommand', 'mvn');
    const preBuild = cfg.get<'none' | 'compile' | 'package' | 'install'>('preBuild', 'compile');
    const extraJvmArgs = cfg.get<string[]>('extraArgs', []);
    // 应用级偏好优先于全局设置
    const buildDependencies = spec.buildDependencies ?? cfg.get<boolean>('buildDependencies', true);
    const runner = cfg.get<'outputChannel' | 'terminal'>('runner', 'outputChannel');
    const autoAttach = cfg.get<boolean>('autoAttach', true);
    const autoOpen = cfg.get<boolean>('autoOpen', false);
    const javaHome = cfg.get<string>('javaHome', '').trim();
    const monitorEnabled = cfg.get<boolean>('monitor', true);
    const coverageWanted = resolveCoverageEnabled(cfg.get<boolean>('coverage', false), spec.coverage);

    // 调试端口避让
    let debugPort: number | undefined;
    if (spec.debug) {
      const base = cfg.get<number>('debugPort', 5005);
      debugPort = await findFreePort(base);
    }

    // 覆盖率 agent：确认工具就绪后拿到 agent jar 与 tcpserver 端口
    let coverageAgent: CoverageAgentSpec | undefined;
    if (coverageWanted && runner === 'terminal') {
      this.log('[覆盖率] 终端模式下无法 dump（拿不到 agent 端口与进程生命周期），本次不启用覆盖率。');
    } else if (coverageWanted) {
      coverageAgent = await this.prepareCoverage(app, cfg, mavenCommand);
    }

    const finalSpec: LaunchSpec = { ...spec, debugPort, coverageAgent };
    const plan = buildCommandPlan(finalSpec, {
      mavenCommand,
      preBuild,
      extraJvmArgs,
      buildDependencies
    });

    const contextPath = resolveContextPath(app.config, spec.profile);
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (javaHome) {
      env.JAVA_HOME = javaHome;
    }

    this.logSection(`${app.id}  ${spec.profile || '(无 profile)'}  ${plan.runLine}`);
    if (app.reactorNote) {
      this.log(`[提示] ${app.reactorNote}，将使用 -f 单独启动。`);
      this.log('[提示] 若报依赖缺失，请先在根目录执行 mvn install -DskipTests。');
    }

    if (runner === 'terminal') {
      return this.launchInTerminal(app, plan.runLine);
    }

    this.output.show(true);

    // 1) 预编译（可被「停止」打断）
    if (plan.preBuild && plan.preBuildLine) {
      this.log(`[1/2] 预编译：${plan.preBuildLine}`);
      this.update(app.id, { state: 'starting', profile: spec.profile, debug: spec.debug, lastCommand: plan.runLine });
      const code = await this.runTracked(app.id, plan.preBuildLine, env);
      if (this.cancelled.delete(app.id)) {
        this.log('[取消] 预编译阶段被停止，已取消启动。');
        this.update(app.id, { state: 'stopped' });
        return false;
      }
      if (code !== 0) {
        this.log(`[失败] 预编译退出码 ${code}，已中止启动。`);
        this.update(app.id, { state: 'stopped' });
        void vscode.window.showErrorMessage(`${app.id} 预编译失败（退出码 ${code}），详见 Web Boot 输出。`);
        return false;
      }
    }

    // 2) 启动
    this.log(`[2/2] 启动：${plan.runLine}`);
    return this.startProcess(app, finalSpec, plan.runLine, env, {
      debugPort,
      autoAttach,
      autoOpen,
      fallbackContextPath: contextPath,
      monitor: monitorEnabled
        ? { javaHome, mainClass: finalSpec.mainClass ?? app.mainClass }
        : undefined
    });
  }

  private startProcess(
    app: BootApp,
    spec: LaunchSpec,
    runLine: string,
    env: NodeJS.ProcessEnv,
    opts: {
      debugPort?: number;
      autoAttach: boolean;
      autoOpen: boolean;
      fallbackContextPath: string;
      /** 运行期 JVM / Tomcat 监控配置；undefined 表示关闭 */
      monitor?: { javaHome: string; mainClass: string };
    }
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let ready = false;
      let detectedPort: number | undefined;
      let detectedContextPath = opts.fallbackContextPath;
      let sawFailure = false;

      const finish = (ok: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        const timer = this.timers.get(app.id);
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(app.id);
        }
        resolve(ok);
      };

      this.update(app.id, {
        state: 'starting',
        profile: spec.profile,
        debug: spec.debug,
        contextPath: detectedContextPath,
        lastCommand: runLine,
        port: spec.port ?? resolvePort(app.config, spec.profile)
      });

      const proc = spawnManaged(runLine, {
        cwd: this.root,
        env,
        onLine: (line) => {
          this.log(line);

          const signals = parseBootLogLine(line);
          if (signals.port !== undefined) {
            detectedPort = signals.port;
          }
          if (signals.contextPath !== undefined) {
            detectedContextPath = signals.contextPath;
          }
          if (signals.failed) {
            sawFailure = true;
          }
          if (signals.portInUse) {
            this.log(
              '[提示] 端口被占用。可用「释放端口（结束占用进程）...」结束占用者，或用「指定端口运行...」换一个端口。'
            );
          }
          if (signals.skipped) {
            sawFailure = true;
            this.log('[失败] spring-boot:run 被跳过：pom 中 spring-boot.run.skip=true 且未被命令行覆盖。');
            this.log('        请在模块 pom 的 <properties> 中加 <spring-boot.run.skip>false</spring-boot.run.skip>。');
          }

          if (!ready && signals.ready) {
            ready = true;
            const port = detectedPort ?? spec.port ?? resolvePort(app.config, spec.profile);
            this.update(app.id, {
              state: 'running',
              port,
              contextPath: detectedContextPath,
              startedAt: Date.now(),
              pid: proc.pid
            });
            this.log(`[就绪] ${app.id} 已在 http://localhost:${port}${detectedContextPath} 启动。`);

            if (opts.monitor) {
              this.monitor.start(app.id, {
                mainClass: opts.monitor.mainClass,
                url: buildUrl(port, detectedContextPath),
                javaHome: opts.monitor.javaHome
              });
            }

            const timer = this.timers.get(app.id);
            if (timer) {
              clearTimeout(timer);
              this.timers.delete(app.id);
            }

            this.afterReady(app, port, detectedContextPath, opts);
            finish(true);
          }
        },
        onExit: (code) => {
          const timer = this.timers.get(app.id);
          if (timer) {
            clearTimeout(timer);
            this.timers.delete(app.id);
          }
          this.processes.delete(app.id);
          this.monitor.stop(app.id);
          this.log(`[退出] ${app.id} 进程结束（退出码 ${code ?? 'unknown'}）。`);
          this.update(app.id, { state: 'stopped', pid: undefined, metrics: undefined });
          // 进程已退出：agent 端口随之关闭，本次运行的覆盖率标记为未启用，
          // 但保留上次的汇总指标与报告路径，树节点仍能看到结果。
          const coverage = this.getRuntime(app.id).coverage;
          if (coverage) {
            this.update(app.id, { coverage: { ...coverage, enabled: false } });
          }
          // 非用户主动停止（崩溃 / 异常退出）时，仍尝试用已有 exec 出一次报告
          if (coverage && !this.cancelled.has(app.id) && this.coverageContexts.has(app.id)) {
            void this.reportCoverage(app.id);
          }

          if (!ready && !settled) {
            const reason = sawFailure ? '启动失败' : '进程已退出';
            this.log(`[失败] ${app.id} ${reason}。请查看上方日志定位原因。`);
            void vscode.window.showErrorMessage(`${app.id} ${reason}（退出码 ${code ?? 'unknown'}）。`);
          }
          finish(ready);
        }
      });

      this.processes.set(app.id, proc);

      const watchdog = setTimeout(() => {
        if (!ready) {
          this.log(`[警告] ${app.id} 超过 ${READY_TIMEOUT_MS / 1000}s 仍未检测到就绪日志，可在输出窗口继续观察。`);
          void vscode.window.showWarningMessage(
            `${app.id} 启动超时，未见 Spring Boot 就绪日志，请查看「Web Boot」输出窗口。`
          );
        }
      }, READY_TIMEOUT_MS);
      this.timers.set(app.id, watchdog);
    });
  }

  private afterReady(
    app: BootApp,
    port: number,
    contextPath: string,
    opts: { debugPort?: number; autoAttach: boolean; autoOpen: boolean }
  ): void {
    const url = buildUrl(port, contextPath);
    if (opts.debugPort && opts.autoAttach) {
      void attachToApp(app.id, opts.debugPort);
    }
    if (url && opts.autoOpen) {
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  /**
   * 对运行中的应用执行 mvn process-resources，把 resources 下的改动拷入 target/classes。
   * 复用 runTracked，执行期间点「停止」会连同该 Maven 进程一起结束。
   */
  async processResources(app: BootApp, spec: LaunchSpec): Promise<boolean> {
    if (this.resourcesRunning.has(app.id)) {
      void vscode.window.showWarningMessage(`${app.id} 正在重新加载资源，请稍候。`);
      return false;
    }

    const cfg = vscode.workspace.getConfiguration('webBoot');
    const javaHome = cfg.get<string>('javaHome', '').trim();
    const command = buildProcessResourcesCommand(spec, {
      mavenCommand: cfg.get<string>('mavenCommand', 'mvn'),
      preBuild: 'none',
      extraJvmArgs: [],
      buildDependencies: spec.buildDependencies ?? cfg.get<boolean>('buildDependencies', true)
    });

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (javaHome) {
      env.JAVA_HOME = javaHome;
    }

    this.logSection(`${app.id}  重新加载资源  ${command}`);
    this.resourcesRunning.add(app.id);
    try {
      const code = await this.runTracked(app.id, command, env);
      if (code === 0) {
        this.log(`[资源] ${app.id} 资源已更新。`);
        return true;
      }
      if (this.cancelled.has(app.id)) {
        this.log(`[资源] ${app.id} 资源重载被停止。`);
      } else {
        this.log(`[失败] process-resources 退出码 ${code}。`);
        void vscode.window.showErrorMessage(
          `${app.id} 重新加载资源失败（退出码 ${code}），详见 Web Boot 输出。`
        );
      }
      return false;
    } finally {
      this.resourcesRunning.delete(app.id);
    }
  }

  // ---------------- 运行时覆盖率（JaCoCo） ----------------

  /**
   * 准备覆盖率：确保 agent / cli 就绪，分配 tcpserver 端口，登记上下文。
   * 任何失败都只降级为「本次不启用覆盖率」，不影响应用启动。
   */
  private async prepareCoverage(
    app: BootApp,
    cfg: vscode.WorkspaceConfiguration,
    mvn: string
  ): Promise<CoverageAgentSpec | undefined> {
    const javaHome = cfg.get<string>('javaHome', '').trim();
    const version =
      (cfg.get<string>('coverageJacocoVersion', DEFAULT_JACOCO_VERSION) || DEFAULT_JACOCO_VERSION)
        .trim() || DEFAULT_JACOCO_VERSION;
    try {
      const tools = await ensureJacocoTools({
        mvn,
        version,
        cacheDir: toolsCacheDir(this.root, version),
        cwd: this.root,
        log: (line) => this.log(line)
      });
      const classfiles = [path.join(app.dir, 'target', 'classes')].filter(existsDir);
      if (classfiles.length === 0) {
        throw new Error(
          `未找到 ${app.relDir}/target/classes，覆盖率需要已编译的字节码（预编译为 none 时请先手动编译）`
        );
      }
      const sourcefiles = [path.join(app.dir, 'src', 'main', 'java')].filter(existsDir);
      const port = await findFreePort(cfg.get<number>('coveragePort', 6300));
      const dir = coverageDir(this.root, app.id);
      fs.mkdirSync(dir, { recursive: true });

      const ctx: CoverageContext = {
        appId: app.id,
        port,
        cliJar: tools.cliJar,
        java: resolveJdkTool(javaHome, 'java'),
        dir,
        execFile: path.join(dir, 'jacoco.exec'),
        htmlDir: path.join(dir, 'html'),
        xmlFile: path.join(dir, 'report.xml'),
        classfiles,
        sourcefiles
      };
      this.coverageContexts.set(app.id, ctx);

      const previous = this.getRuntime(app.id).coverage;
      this.update(app.id, {
        coverage: {
          enabled: true,
          port,
          execFile: ctx.execFile,
          reportDir: ctx.htmlDir,
          xmlFile: ctx.xmlFile,
          summary: previous?.summary,
          updatedAt: Date.now()
        }
      });
      this.log(
        `[覆盖率] ${app.id} 挂载 JaCoCo ${version} agent：tcpserver 127.0.0.1:${port}，exec 累积到 ${path.relative(this.root, ctx.execFile)}。`
      );
      return { jar: tools.agentJar, port, sessionId: app.id };
    } catch (err) {
      const message = friendlyError(err, 'java');
      this.log(`[覆盖率] 准备失败，本次不启用覆盖率：${message}`);
      this.coverageContexts.delete(app.id);
      this.update(app.id, {
        coverage: { enabled: false, error: message, updatedAt: Date.now() }
      });
      void vscode.window.showWarningMessage(`${app.id} 覆盖率不可用：${message}`);
      return undefined;
    }
  }

  /** 把覆盖率状态合并进 AppRuntime；保留既有字段 */
  private patchCoverage(appId: string, patch: Partial<CoverageState>): void {
    const current = this.getRuntime(appId).coverage;
    this.update(appId, {
      coverage: {
        enabled: current?.enabled ?? false,
        ...current,
        ...patch,
        updatedAt: Date.now()
      }
    });
  }

  /**
   * 连 agent 端口 dump 出 exec，再与历史 exec 合并。
   * 必须在杀进程之前调用：taskkill /F 不会给 JVM 任何收尾机会。
   */
  private async dumpCoverage(appId: string): Promise<boolean> {
    const ctx = this.coverageContexts.get(appId);
    if (!ctx || this.coverageBusy.has(appId)) {
      return false;
    }
    this.coverageBusy.add(appId);
    try {
      const partial = path.join(ctx.dir, `dump-${Date.now()}.exec`);
      await execText(
        ctx.java,
        buildDumpArgs({ cliJar: ctx.cliJar, port: ctx.port, dest: partial }),
        DUMP_TIMEOUT_MS
      );

      const files = existsFile(ctx.execFile) ? [ctx.execFile, partial] : [partial];
      const merged = path.join(ctx.dir, `jacoco-${Date.now()}.tmp`);
      await execText(
        ctx.java,
        buildMergeArgs({ cliJar: ctx.cliJar, files, dest: merged }),
        MERGE_TIMEOUT_MS
      );
      fs.renameSync(merged, ctx.execFile);
      if (files.length > 1) {
        // 单次 dump 已并入 jacoco.exec，删掉避免目录里堆小文件
        try {
          fs.unlinkSync(partial);
        } catch {
          // 删不掉不影响结果
        }
      }
      this.patchCoverage(appId, { execFile: ctx.execFile, error: undefined });
      this.log(`[覆盖率] ${appId} 已 dump（合并 ${files.length} 份 exec）。`);
      return true;
    } catch (err) {
      const message = friendlyError(err, 'java');
      this.log(`[覆盖率] ${appId} dump 失败：${message}`);
      this.patchCoverage(appId, { error: message });
      return false;
    } finally {
      this.coverageBusy.delete(appId);
    }
  }

  /** 用累积的 exec 生成 HTML + XML，并把指标写进 runtime.coverage.summary */
  private async reportCoverage(appId: string): Promise<boolean> {
    const ctx = this.coverageContexts.get(appId);
    if (!ctx) {
      return false;
    }
    if (!existsFile(ctx.execFile)) {
      this.log(`[覆盖率] ${appId} 还没有 exec 数据，先启动应用访问接口后再采样。`);
      return false;
    }
    if (this.coverageBusy.has(appId)) {
      return false;
    }
    this.coverageBusy.add(appId);
    try {
      fs.mkdirSync(ctx.htmlDir, { recursive: true });
      await execText(
        ctx.java,
        buildReportArgs({
          cliJar: ctx.cliJar,
          exec: ctx.execFile,
          classfiles: ctx.classfiles,
          sourcefiles: ctx.sourcefiles,
          htmlDir: ctx.htmlDir,
          xmlFile: ctx.xmlFile,
          name: appId
        }),
        REPORT_TIMEOUT_MS
      );
      const summary = parseJacocoXml(fs.readFileSync(ctx.xmlFile, 'utf8'));
      this.patchCoverage(appId, {
        execFile: ctx.execFile,
        reportDir: ctx.htmlDir,
        xmlFile: ctx.xmlFile,
        summary,
        error: undefined
      });
      this.log(
        `[覆盖率] ${appId} 行 ${formatRate(summary.line.rate)} / 分支 ${formatRate(
          summary.branch.rate
        )} / 类 ${formatRate(summary.clazz.rate)}，报告：${path.relative(
          this.root,
          path.join(ctx.htmlDir, 'index.html')
        )}`
      );
      return true;
    } catch (err) {
      const message = friendlyError(err, 'java');
      this.log(`[覆盖率] ${appId} 生成报告失败：${message}`);
      this.patchCoverage(appId, { error: message });
      return false;
    } finally {
      this.coverageBusy.delete(appId);
    }
  }

  /**
   * 手动采样：运行中先 dump（拿到最新执行数据）再出报告；
   * 已停止时直接用累积的 exec 重新出一次报告。
   */
  async sampleCoverage(appId: string): Promise<boolean> {
    const ctx = this.coverageContexts.get(appId);
    if (!ctx) {
      void vscode.window.showWarningMessage(
        `${appId} 本次启动未启用覆盖率，请开启覆盖率后重新启动。`
      );
      return false;
    }
    const running = ['running', 'starting'].includes(this.getRuntime(appId).state);
    if (running) {
      await this.dumpCoverage(appId);
    }
    const ok = await this.reportCoverage(appId);
    if (ok) {
      const summary = this.getRuntime(appId).coverage?.summary;
      if (summary) {
        void vscode.window.showInformationMessage(
          `${appId} 覆盖率：行 ${formatRate(summary.line.rate)}，分支 ${formatRate(
            summary.branch.rate
          )}。`
        );
      }
    } else if (!this.getRuntime(appId).coverage?.error) {
      void vscode.window.showWarningMessage(
        `${appId} 还没有覆盖率数据，请先启动应用并访问接口。`
      );
    }
    return ok;
  }

  /** HTML 报告入口（index.html）；尚未生成时返回 undefined */
  coverageReportFile(appId: string): string | undefined {
    const ctx = this.coverageContexts.get(appId);
    const candidates = [
      ctx ? path.join(ctx.htmlDir, 'index.html') : undefined,
      this.getRuntime(appId).coverage?.reportDir
        ? path.join(this.getRuntime(appId).coverage?.reportDir as string, 'index.html')
        : undefined
    ].filter((p): p is string => !!p);
    return candidates.find((p) => existsFile(p));
  }

  /** 终端模式：无法检测就绪，仅负责把命令送进终端 */
  private launchInTerminal(app: BootApp, runLine: string): boolean {
    const terminal = vscode.window.createTerminal({
      name: `Web Boot: ${app.id}`,
      cwd: this.root
    });
    terminal.show(true);
    terminal.sendText(runLine, true);
    this.update(app.id, { state: 'running', startedAt: Date.now(), lastCommand: runLine });
    this.log('[提示] 终端模式下无法检测启动完成，也不会自动 attach；需要调试请切换到 outputChannel 模式。');
    return true;
  }

  /** 停止一个应用（结束整棵进程树，含预编译阶段） */
  async stop(appId: string): Promise<void> {
    this.monitor.stop(appId);
    this.cancelled.add(appId);

    const build = this.buildProcesses.get(appId);
    if (build) {
      this.log(`[停止] 正在结束 ${appId} 的预编译（pid ${build.pid}）...`);
      await build.stop();
      this.buildProcesses.delete(appId);
    }

    const proc = this.processes.get(appId);
    if (!proc) {
      this.update(appId, { state: 'stopped', pid: undefined, metrics: undefined });
      return;
    }
    this.update(appId, { state: 'stopping' });

    // 覆盖率：必须在杀进程之前 dump —— taskkill /F 不触发 JVM shutdown hook
    const hasCoverage = this.coverageContexts.has(appId);
    if (hasCoverage) {
      this.log(`[覆盖率] ${appId} 结束前 dump 执行数据...`);
      await this.dumpCoverage(appId);
    }

    this.log(`[停止] 正在结束 ${appId}（pid ${proc.pid}）...`);
    await proc.stop();
    this.processes.delete(appId);
    this.update(appId, { state: 'stopped', pid: undefined, metrics: undefined });
    this.log(`[停止] ${appId} 已结束。`);

    if (hasCoverage) {
      this.patchCoverage(appId, { enabled: false });
      await this.reportCoverage(appId);
    }
  }

  async stopAll(): Promise<void> {
    const ids = new Set<string>([...this.processes.keys(), ...this.buildProcesses.keys()]);
    for (const appId of ids) {
      await this.stop(appId);
    }
  }

  /** 生成「可复制」的启动命令，不做任何实际启动 */
  describe(spec: LaunchSpec): string {
    const cfg = vscode.workspace.getConfiguration('webBoot');
    const plan = buildCommandPlan(spec, {
      mavenCommand: cfg.get<string>('mavenCommand', 'mvn'),
      preBuild: cfg.get<'none' | 'compile' | 'package' | 'install'>('preBuild', 'compile'),
      extraJvmArgs: cfg.get<string[]>('extraArgs', []),
      buildDependencies:
        spec.buildDependencies ?? cfg.get<boolean>('buildDependencies', true)
    });
    return plan.preBuildLine ? `${plan.preBuildLine}\n${plan.runLine}` : plan.runLine;
  }

  /** 取某应用当前生效 profile（偏好 > application.yml 默认） */
  static effectiveProfile(app: BootApp, preferred?: string): string {
    return preferred || defaultProfile(app.config);
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.monitor.dispose();
    this.emitter.dispose();
  }
}
