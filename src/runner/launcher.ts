/**
 * 启动器：负责一条应用的完整生命周期（预编译 -> 启动 -> 就绪 -> 停止）。
 *
 * 之所以走 mvn spring-boot:run 而不是 java 直启：多模块项目的 classpath
 * 由 Maven 解析，天然正确；本仓库 mes-web/pom.xml 还特意开了
 * <useClasspathFile>true</useClasspathFile> 来解决 Windows classpath 过长
 * （error=206）。走 java 直启会重新踩这些坑。
 */
import * as vscode from 'vscode';
import type { AppRuntime, BootApp, LaunchSpec } from '../model/types';
import { defaultProfile, resolveContextPath, resolvePort } from '../scanner/springConfig';
import { attachToApp } from '../debug/attach';
import { buildCommandPlan, buildUrl } from './command';
import { parseBootLogLine } from './logParser';
import { MetricsMonitor } from './monitor';
import { spawnManaged, type ManagedProcess } from './processManager';
import { findFreePort } from '../util/ports';

const READY_TIMEOUT_MS = 240_000;

export class BootRunner implements vscode.Disposable {
  private readonly runtimes = new Map<string, AppRuntime>();
  private readonly processes = new Map<string, ManagedProcess>();
  /** 预编译阶段的子进程，便于「停止」时打断 */
  private readonly buildProcesses = new Map<string, ManagedProcess>();
  /** 已被用户取消启动的应用 */
  private readonly cancelled = new Set<string>();
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

    // 调试端口避让
    let debugPort: number | undefined;
    if (spec.debug) {
      const base = cfg.get<number>('debugPort', 5005);
      debugPort = await findFreePort(base);
    }

    const finalSpec: LaunchSpec = { ...spec, debugPort };
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
            this.log('[提示] 端口被占用。可用「指定端口运行...」换一个端口，或先停止占用该端口的应用。');
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
    this.log(`[停止] 正在结束 ${appId}（pid ${proc.pid}）...`);
    await proc.stop();
    this.processes.delete(appId);
    this.update(appId, { state: 'stopped', pid: undefined, metrics: undefined });
    this.log(`[停止] ${appId} 已结束。`);
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
