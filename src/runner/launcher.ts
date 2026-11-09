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
import type {
  AppRuntime,
  AppState,
  BootApp,
  CoverageAgentSpec,
  CoverageState,
  LaunchSpec
} from '../model/types';
import { defaultProfile, resolveContextPath, resolvePort } from '../scanner/springConfig';
import { attachToApp } from '../debug/attach';
import { buildCommandPlan, buildProcessResourcesCommand, buildUrl } from './command';
import {
  DEFAULT_JACOCO_VERSION,
  buildDumpArgs,
  buildMergeArgs,
  buildReportArgs,
  cliJarName,
  coverageDir,
  ensureJacocoTools,
  parseJacocoXml,
  resolveCoverageEnabled,
  toolsCacheDir
} from './coverage';
import { parseBootLogLine } from './logParser';
import { MetricsMonitor } from './monitor';
import { spawnManaged, type ManagedProcess } from './processManager';
import type { PersistedAppRuntime } from './state';
import { findFreePort, isPortFree } from '../util/ports';
import { isPidAlive, killProcessTree } from '../util/portProcess';
import { execText, friendlyError, resolveJdkTool } from '../util/jdk';
import { t } from '../i18n';

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
  /**
   * 上一会话遗留、被本会话接管的进程：只有 pid，没有 ChildProcess 句柄。
   * 扩展宿主重启后 stdout 管道已断，只能靠 pid 存活检查与整组结束来管理。
   */
  private readonly adopted = new Map<string, number>();
  /** 接管进程的存活巡检（进程被外部杀掉时把状态刷回 stopped） */
  private readonly adoptedTimers = new Map<string, NodeJS.Timeout>();
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

  // ---------------- 跨会话状态恢复 ----------------

  /**
   * 导出仍在运行的应用快照，供扩展写进 workspaceState。
   * 只记录本会话起的进程（句柄还在）或已接管的进程 —— 终端模式下进程不归扩展管，
   * 拿不到 pid，也没法保证跨会话还在，因此不落盘。
   */
  snapshot(): PersistedAppRuntime[] {
    const entries: PersistedAppRuntime[] = [];
    for (const [appId, rt] of this.runtimes) {
      if (rt.state !== 'running' && rt.state !== 'starting') {
        continue;
      }
      const pid = rt.pid;
      if (!pid || !isPidAlive(pid)) {
        continue;
      }
      if (!this.processes.has(appId) && !this.adopted.has(appId)) {
        continue;
      }
      entries.push({
        appId,
        state: rt.state,
        pid,
        port: rt.port,
        contextPath: rt.contextPath,
        profile: rt.profile,
        debug: rt.debug,
        startedAt: rt.startedAt,
        lastCommand: rt.lastCommand,
        coverage: rt.coverage
          ? {
              enabled: rt.coverage.enabled,
              port: rt.coverage.port,
              execFile: rt.coverage.execFile,
              reportDir: rt.coverage.reportDir,
              xmlFile: rt.coverage.xmlFile,
              summary: rt.coverage.summary
            }
          : undefined
      });
    }
    return entries;
  }

  /** 该应用是否跑在上一会话遗留的进程上 */
  isAdopted(appId: string): boolean {
    return this.adopted.has(appId);
  }

  /**
   * 接管上一会话遗留的进程：校验 pid 还在就恢复成运行中。
   * 返回 false 表示进程已不存在（或该应用已有实例），由调用方按未运行处理。
   *
   * 注意：stdout 管道随宿主退出已断，接管后没有日志输出，
   * 需要日志时请「重启」；但打开 / 停止 / 覆盖率 dump 都能继续用。
   */
  async adopt(app: BootApp, entry: PersistedAppRuntime): Promise<boolean> {
    if (this.isBusy(app.id)) {
      return false;
    }
    if (!isPidAlive(entry.pid)) {
      return false;
    }

    // 上次快照是「启动中」时，就绪日志已经丢了；端口在监听就认为已经起来
    let state: AppState = entry.state;
    if (state === 'starting' && entry.port !== undefined && !(await isPortFree(entry.port))) {
      state = 'running';
    }

    this.adopted.set(app.id, entry.pid);
    this.restoreCoverageContext(app, entry);

    const coverage: CoverageState | undefined = entry.coverage
      ? {
          enabled: entry.coverage.enabled ?? false,
          port: entry.coverage.port,
          execFile: entry.coverage.execFile,
          reportDir: entry.coverage.reportDir,
          xmlFile: entry.coverage.xmlFile,
          summary: entry.coverage.summary,
          updatedAt: Date.now()
        }
      : undefined;

    this.update(app.id, {
      state,
      profile: entry.profile,
      port: entry.port,
      contextPath: entry.contextPath,
      debug: entry.debug,
      pid: entry.pid,
      startedAt: entry.startedAt ?? Date.now(),
      lastCommand: entry.lastCommand,
      metrics: undefined,
      coverage
    });

    this.log(
      t(
        'log.adopted',
        app.id,
        entry.pid,
        entry.port === undefined ? t('common.unknownPort') : entry.port,
        entry.lastCommand ?? ''
      )
    );

    const cfg = vscode.workspace.getConfiguration('webBoot');
    if (cfg.get<boolean>('monitor', true)) {
      const profile = entry.profile ?? defaultProfile(app.config);
      this.monitor.start(app.id, {
        mainClass: app.mainClass,
        url: buildUrl(entry.port, entry.contextPath ?? resolveContextPath(app.config, profile)),
        javaHome: cfg.get<string>('javaHome', '').trim()
      });
    }

    // 进程可能被外部（任务管理器 / kill）结束：定期巡检，把状态刷回未运行
    this.clearAdoptedWatch(app.id);
    const timer = setInterval(() => {
      if (isPidAlive(entry.pid)) {
        return;
      }
      this.log(t('log.adoptedExited', app.id, entry.pid));
      this.clearAdoptedWatch(app.id);
      this.adopted.delete(app.id);
      this.monitor.stop(app.id);
      this.update(app.id, { state: 'stopped', pid: undefined, metrics: undefined });
    }, 15_000);
    this.adoptedTimers.set(app.id, timer);
    return true;
  }

  private clearAdoptedWatch(appId: string): void {
    const timer = this.adoptedTimers.get(appId);
    if (timer) {
      clearInterval(timer);
      this.adoptedTimers.delete(appId);
    }
  }

  /**
   * 重建覆盖率上下文，让接管的进程在停止时仍能 dump 出这一段时间的执行数据。
   * 任何一步不满足（缓存 jar 被删、target/classes 不在）就放弃，只影响覆盖率，不影响接管。
   */
  private restoreCoverageContext(app: BootApp, entry: PersistedAppRuntime): void {
    const coverage = entry.coverage;
    if (!coverage?.port || !coverage.execFile) {
      return;
    }
    try {
      const cfg = vscode.workspace.getConfiguration('webBoot');
      const version =
        (
          cfg.get<string>('coverageJacocoVersion', DEFAULT_JACOCO_VERSION) || DEFAULT_JACOCO_VERSION
        ).trim() || DEFAULT_JACOCO_VERSION;
      const cliJar = path.join(toolsCacheDir(this.root, version), cliJarName(version));
      if (!existsFile(cliJar) || !existsFile(coverage.execFile)) {
        return;
      }
      const classfiles = [path.join(app.dir, 'target', 'classes')].filter(existsDir);
      if (classfiles.length === 0) {
        return;
      }
      const dir = coverageDir(this.root, app.id);
      this.coverageContexts.set(app.id, {
        appId: app.id,
        port: coverage.port,
        cliJar,
        java: resolveJdkTool(cfg.get<string>('javaHome', '').trim(), 'java'),
        dir,
        execFile: coverage.execFile,
        htmlDir: coverage.reportDir ?? path.join(dir, 'html'),
        xmlFile: coverage.xmlFile ?? path.join(dir, 'report.xml'),
        classfiles,
        sourcefiles: [path.join(app.dir, 'src', 'main', 'java')].filter(existsDir)
      });
    } catch {
      // 重建失败不阻断接管
      this.coverageContexts.delete(app.id);
    }
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
      void vscode.window.showWarningMessage(t('msg.busy', app.id));
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
      this.log(t('log.coverageTerminalUnsupported'));
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

    this.logSection(
      `${app.id}  ${spec.profile || t('common.noProfile')}  ${plan.runLine}`
    );
    if (app.reactorNote) {
      this.log(t('log.reactorNote', app.reactorNote));
      this.log(t('log.installHint'));
    }

    if (runner === 'terminal') {
      return this.launchInTerminal(app, plan.runLine);
    }

    this.output.show(true);

    // 1) 预编译（可被「停止」打断）
    if (plan.preBuild && plan.preBuildLine) {
      this.log(t('log.preBuild', plan.preBuildLine));
      this.update(app.id, { state: 'starting', profile: spec.profile, debug: spec.debug, lastCommand: plan.runLine });
      const code = await this.runTracked(app.id, plan.preBuildLine, env);
      if (this.cancelled.delete(app.id)) {
        this.log(t('log.preBuildCancelled'));
        this.update(app.id, { state: 'stopped' });
        return false;
      }
      if (code !== 0) {
        this.log(t('log.preBuildFailed', code));
        this.update(app.id, { state: 'stopped' });
        void vscode.window.showErrorMessage(t('msg.preBuildFailed', app.id, code));
        return false;
      }
    }

    // 2) 启动
    this.log(t('log.starting', plan.runLine));
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
            this.log(t('log.portInUseHint'));
          }
          if (signals.skipped) {
            sawFailure = true;
            this.log(t('log.runSkipped'));
            this.log(t('log.runSkippedHint'));
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
            this.log(
              t('log.ready', app.id, `http://localhost:${port}${detectedContextPath}`)
            );

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
          this.log(t('log.exited', app.id, code ?? 'unknown'));
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
            const reason = sawFailure ? t('common.startFailed') : t('common.processExited');
            this.log(t('log.startFailedDetail', app.id, reason));
            void vscode.window.showErrorMessage(t('msg.startFailed', app.id, reason, code ?? 'unknown'));
          }
          finish(ready);
        }
      });

      this.processes.set(app.id, proc);

      const watchdog = setTimeout(() => {
        if (!ready) {
          this.log(t('log.readyTimeout', app.id, READY_TIMEOUT_MS / 1000));
          void vscode.window.showWarningMessage(t('msg.readyTimeout', app.id));
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
      void vscode.window.showWarningMessage(t('msg.resourcesBusy', app.id));
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

    this.logSection(t('log.reloadingResources', app.id, command));
    this.resourcesRunning.add(app.id);
    try {
      const code = await this.runTracked(app.id, command, env);
      if (code === 0) {
        this.log(t('log.resourcesUpdated', app.id));
        return true;
      }
      if (this.cancelled.has(app.id)) {
        this.log(t('log.resourcesStopped', app.id));
      } else {
        this.log(t('log.processResourcesFailed', code));
        void vscode.window.showErrorMessage(t('msg.processResourcesFailed', app.id, code));
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
        throw new Error(t('error.coverageNoClasses', app.relDir));
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
        t(
          'log.coverageAttached',
          app.id,
          version,
          port,
          path.relative(this.root, ctx.execFile)
        )
      );
      return { jar: tools.agentJar, port, sessionId: app.id };
    } catch (err) {
      const message = friendlyError(err, 'java');
      this.log(t('log.coveragePrepareFailed', message));
      this.coverageContexts.delete(app.id);
      this.update(app.id, {
        coverage: { enabled: false, error: message, updatedAt: Date.now() }
      });
      void vscode.window.showWarningMessage(t('msg.coverageUnavailable', app.id, message));
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
      this.log(t('log.coverageDumped', appId, files.length));
      return true;
    } catch (err) {
      const message = friendlyError(err, 'java');
      this.log(t('log.coverageDumpFailed', appId, message));
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
      this.log(t('log.coverageNoExec', appId));
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
        t(
          'log.coverageReport',
          appId,
          formatRate(summary.line.rate),
          formatRate(summary.branch.rate),
          formatRate(summary.clazz.rate),
          path.relative(this.root, path.join(ctx.htmlDir, 'index.html'))
        )
      );
      return true;
    } catch (err) {
      const message = friendlyError(err, 'java');
      this.log(t('log.coverageReportFailed', appId, message));
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
      void vscode.window.showWarningMessage(t('msg.coverageNotEnabled', appId));
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
          t(
            'msg.coverageResult',
            appId,
            formatRate(summary.line.rate),
            formatRate(summary.branch.rate)
          )
        );
      }
    } else if (!this.getRuntime(appId).coverage?.error) {
      void vscode.window.showWarningMessage(t('msg.coverageNoData', appId));
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
    this.log(t('log.terminalModeHint'));
    return true;
  }

  /** 停止一个应用（结束整棵进程树，含预编译阶段） */
  async stop(appId: string): Promise<void> {
    this.monitor.stop(appId);
    this.cancelled.add(appId);

    const build = this.buildProcesses.get(appId);
    if (build) {
      this.log(t('log.stoppingBuild', appId, build.pid));
      await build.stop();
      this.buildProcesses.delete(appId);
    }

    const proc = this.processes.get(appId);
    const adoptedPid = this.adopted.get(appId);
    if (!proc && adoptedPid === undefined) {
      this.update(appId, { state: 'stopped', pid: undefined, metrics: undefined });
      return;
    }
    const legacyPid = proc ? undefined : adoptedPid;
    this.update(appId, { state: 'stopping' });
    // 覆盖率：必须在杀进程之前 dump —— taskkill /F 不触发 JVM shutdown hook
    const hasCoverage = this.coverageContexts.has(appId);
    if (hasCoverage) {
      this.log(t('log.coverageDumpBeforeStop', appId));
      await this.dumpCoverage(appId);
    }

    if (proc) {
      this.log(t('log.stopping', appId, proc.pid));
      await proc.stop();
      this.processes.delete(appId);
    } else if (legacyPid !== undefined) {
      // 接管来的进程没有句柄：Windows 用 taskkill /T 结束整棵树，
      // POSIX 按进程组结束（mvn 是独立进程组的组长，只杀它会留下 java）
      this.log(t('log.stoppingAdopted', appId, legacyPid));
      const result = await killProcessTree(legacyPid, { group: process.platform !== 'win32' });
      if (!result.ok) {
        this.log(t('log.stoppingAdoptedFailed', appId, legacyPid, result.error ?? ''));
      }
      this.clearAdoptedWatch(appId);
      this.adopted.delete(appId);
    }
    this.update(appId, { state: 'stopped', pid: undefined, metrics: undefined });
    this.log(t('log.stopped', appId));

    if (hasCoverage) {
      this.patchCoverage(appId, { enabled: false });
      await this.reportCoverage(appId);
    }
  }

  async stopAll(): Promise<void> {
    const ids = new Set<string>([
      ...this.processes.keys(),
      ...this.buildProcesses.keys(),
      ...this.adopted.keys()
    ]);
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
    for (const timer of this.adoptedTimers.values()) {
      clearInterval(timer);
    }
    this.adoptedTimers.clear();
    this.monitor.dispose();
    this.emitter.dispose();
  }
}
