/**
 * Web Boot Runner 入口。
 *
 * 职责：扫描工作区 -> 渲染侧边栏树 -> 处理命令 -> 维护状态栏与文件监听。
 * 具体启动逻辑在 runner/launcher.ts，扫描逻辑在 scanner/。
 */
import * as vscode from 'vscode';
import { scanReactor } from './scanner/maven';
import { scanBootApps } from './scanner/bootApps';
import {
  defaultProfile,
  resolveContextPath,
  resolvePort as resolvePortFromConfig
} from './scanner/springConfig';
import { PreferenceStore } from './config/store';
import { BootRunner } from './runner/launcher';
import {
  AppTreeItem,
  AppsDragAndDropController,
  AppsTreeProvider,
  GroupTreeItem,
  type WebBootTreeItem
} from './views/appsTreeProvider';
import {
  computeConflicts,
  findFreePort,
  isPortFree,
  waitPortFree,
  type EffectiveTarget,
  type PortConflict
} from './util/ports';
import {
  findPortOwners,
  formatOwner,
  killPortOwners,
  type PortOwner
} from './util/portProcess';
import { buildLaunchConfigs, writeLaunchJson } from './commands/generateLaunchJson';
import { buildUrl } from './runner/command';
import { initI18n, t } from './i18n';
import type { AppPreference, BootApp, LaunchSpec } from './model/types';

let output: vscode.OutputChannel;
let runner: BootRunner;
let store: PreferenceStore;
let provider: AppsTreeProvider;
let statusItem: vscode.StatusBarItem;
let treeView: vscode.TreeView<WebBootTreeItem> | undefined;
let apps: BootApp[] = [];
let conflictMap = new Map<string, PortConflict>();
let refreshTimer: NodeJS.Timeout | undefined;

function rootDir(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error(t('error.noWorkspace'));
  }
  return folder.uri.fsPath;
}

function resolveProfile(app: BootApp, pref?: AppPreference): string {
  return pref?.profile || defaultProfile(app.config);
}

function resolvePortValue(app: BootApp, profile: string, pref?: AppPreference): number {
  return pref?.port ?? resolvePortFromConfig(app.config, profile);
}

/** 重新计算端口冲突（按各应用当前生效 profile/端口） */
function recomputeConflicts(): void {
  const targets: EffectiveTarget[] = apps.map((app) => {
    const pref = store.get(app.id);
    const profile = resolveProfile(app, pref);
    return {
      appId: app.id,
      profile,
      port: resolvePortValue(app, profile, pref),
      contextPath: resolveContextPath(app.config, profile)
    };
  });
  const conflicts = computeConflicts(targets);
  conflictMap = new Map<string, PortConflict>();
  for (const conflict of conflicts) {
    for (const appId of conflict.appIds) {
      conflictMap.set(appId, conflict);
    }
  }
}

/**
 * 刷新视图角标：把「运行中 + 启动中」的数量挂在活动栏的 Web Boot 图标上。
 * 0 个应用在跑时清空角标（VS Code 的 badge 无法隐藏，只能置为 undefined）。
 */
function updateViewBadge(running: number, starting: number): void {
  if (!treeView) {
    return;
  }
  const total = running + starting;
  if (total <= 0) {
    treeView.badge = undefined;
    return;
  }
  const parts: string[] = [];
  if (running > 0) {
    parts.push(t('status.running', running));
  }
  if (starting > 0) {
    parts.push(t('status.starting', starting));
  }
  treeView.badge = { value: total, tooltip: parts.join(' / ') };
}

/**
 * 刷新状态栏文本；同时刷新活动栏图标角标（所有状态变化都会走到这里）。
 */
function updateStatusBar(): void {
  const running = apps.filter((a) => runner.getRuntime(a.id).state === 'running').length;
  const starting = apps.filter((a) => runner.getRuntime(a.id).state === 'starting').length;
  updateViewBadge(running, starting);
  if (running > 0 || starting > 0) {
    statusItem.text = `$(circle-filled) Web Boot ${t('status.running', running)}${
      starting ? ` / ${t('status.starting', starting)}` : ''
    }`;
  } else {
    statusItem.text = `$(circle-outline) Web Boot ${t('status.appCount', apps.length)}`;
  }
  statusItem.tooltip = t('status.tooltip');
  statusItem.show();
}

async function scanAndRefresh(): Promise<void> {
  try {
    const root = rootDir();
    const reactor = scanReactor(root);
    apps = await scanBootApps(root, reactor);
    recomputeConflicts();
    provider.setApps(apps);
    updateStatusBar();
    output.appendLine(
      t(
        'log.scanSummary',
        root,
        reactor.size,
        apps.length,
        new Set(conflictMap.keys()).size
      )
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output.appendLine(t('log.scanFailed', message));
    void vscode.window.showErrorMessage(t('msg.scanFailed', message));
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    void scanAndRefresh();
  }, 800);
}

/** 从命令参数里取应用，取不到就让用户选 */
async function pickApp(arg?: unknown, runningOnly = false): Promise<BootApp | undefined> {
  if (arg instanceof AppTreeItem) {
    return arg.app;
  }
  if (apps.length === 0) {
    await scanAndRefresh();
  }
  const candidates = runningOnly
    ? apps.filter((a) => runner.getRuntime(a.id).state === 'running' || runner.getRuntime(a.id).state === 'starting')
    : apps;
  if (candidates.length === 0) {
    if (runningOnly) {
      void vscode.window.showInformationMessage(t('msg.noRunningApps'));
    } else {
      void vscode.window.showWarningMessage(t('msg.noApps'));
    }
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map((a) => {
      const pref = store.get(a.id);
      const profile = resolveProfile(a, pref);
      const port = resolvePortValue(a, profile, pref);
      return {
        label: a.id,
        description: `${profile || t('common.noProfile')} · :${port}${
          a.inReactor ? '' : t('common.notInReactorSuffix')
        }`,
        detail: a.relDir,
        app: a
      };
    }),
    {
      placeHolder: runningOnly ? t('quickPick.pickAppToStop') : t('quickPick.pickAppToStart'),
      matchOnDetail: true
    }
  );
  return picked?.app;
}

/** 命令行太长会撑爆对话框，截断后保留头部特征 */
function clip(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** 把占用者整理成对话框里的多行摘要 */
function describePortOwners(owners: PortOwner[]): string {
  const shown = owners.slice(0, 3);
  const lines = shown.map((owner) => {
    const cmd = owner.commandLine ? `\n    ${clip(owner.commandLine)}` : '';
    return `  · ${formatOwner(owner)}${cmd}`;
  });
  if (owners.length > shown.length) {
    lines.push(t('tree.moreOwners', owners.length - shown.length));
  }
  return lines.join('\n');
}

/** 终端模式下进程不归扩展管，不能走 runner.stop()，只能按外部进程处理 */
function managedAppsStoppable(): boolean {
  return (
    vscode.workspace.getConfiguration('webBoot').get<string>('runner', 'outputChannel') !==
    'terminal'
  );
}

/** 找到占用该端口且由 Web Boot 管理的应用（运行中 / 启动中 / 停止中） */
function findManagedAppOnPort(port: number, exceptAppId?: string): BootApp | undefined {
  return apps.find((app) => {
    if (app.id === exceptAppId) {
      return false;
    }
    const runtime = runner.getRuntime(app.id);
    if (!['running', 'starting', 'stopping'].includes(runtime.state)) {
      return false;
    }
    if (runtime.port !== undefined) {
      return runtime.port === port;
    }
    // 终端模式不记录实际端口，退回配置值匹配
    const pref = store.get(app.id);
    const profile = resolveProfile(app, pref);
    return resolvePortValue(app, profile, pref) === port;
  });
}

/** 结束占用端口的进程，并确认端口真正释放 */
async function killOwnersAndWait(port: number, owners: PortOwner[]): Promise<boolean> {
  output.appendLine(
    t('log.portKilling', port, owners.map(formatOwner).join(t('common.listSeparator')))
  );
  const result = await killPortOwners(owners);
  for (const pid of result.killed) {
    output.appendLine(t('log.portKilledPid', pid));
  }
  for (const failed of result.failed) {
    output.appendLine(t('log.portKillPidFailed', failed.pid, failed.error));
  }
  if (result.failed.length > 0) {
    void vscode.window.showErrorMessage(
      t(
        'msg.portKillPartialFailed',
        port,
        result.failed.map((f) => f.pid).join(', ')
      )
    );
    return false;
  }
  if (!(await waitPortFree(port))) {
    void vscode.window.showErrorMessage(t('msg.portStillOccupiedAfterKill', port));
    return false;
  }
  output.appendLine(t('log.portReleased', port));
  return true;
}

/** 端口冲突对话框的三个通用选项（按当前语言取文案，回调里用文案反查动作） */
interface PortButtons {
  auto: string;
  keep: string;
  cancel: string;
}

function portButtons(): PortButtons {
  return {
    auto: t('button.switchPort'),
    keep: t('button.keepPort'),
    cancel: t('button.cancel')
  };
}

type PortChoice = 'auto' | 'keep';

function toPortChoice(label: string | undefined, buttons: PortButtons): PortChoice | undefined {
  if (label === buttons.auto) {
    return 'auto';
  }
  if (label === buttons.keep) {
    return 'keep';
  }
  return undefined;
}

/** 处理「自动换端口 / 仍用该端口 / 取消」三个通用选项 */
async function resolvePortChoice(
  choice: PortChoice | undefined,
  app: BootApp,
  desired: number
): Promise<number | null> {
  if (choice === 'auto') {
    const free = await findFreePort(desired + 1);
    output.appendLine(t('log.portSwitched', app.id, desired, free));
    return free;
  }
  if (choice === 'keep') {
    return desired;
  }
  return null;
}

/**
 * 启动前确认端口可用。返回 null 表示用户取消。
 * 端口被占用时先看占用者是谁：Web Boot 自己管理的应用直接停止（保留覆盖率 dump），
 * 外部进程展示 PID / 进程名 / 命令行并支持一键结束，识别不到时退回换端口。
 */
async function ensurePort(
  app: BootApp,
  profile: string,
  pref: AppPreference
): Promise<number | null> {
  const desired = resolvePortValue(app, profile, pref);
  if (await isPortFree(desired)) {
    return desired;
  }
  const runningSelf = runner.getRuntime(app.id).state === 'running';
  if (runningSelf) {
    void vscode.window.showWarningMessage(t('msg.appAlreadyRunning', app.id));
    return null;
  }

  // 占用者是 Web Boot 管理的应用：不走 taskkill，保留 JaCoCo dump 与状态更新
  const managed = managedAppsStoppable()
    ? findManagedAppOnPort(desired, app.id)
    : undefined;
  if (managed) {
    const buttons = portButtons();
    const stopAndStart = t('button.stopItAndStart');
    const choice = await vscode.window.showWarningMessage(
      t('msg.portUsedByManaged', app.id, desired, managed.id),
      stopAndStart,
      buttons.auto,
      buttons.keep,
      buttons.cancel
    );
    if (choice === stopAndStart) {
      output.appendLine(t('log.portStoppingManagedFor', managed.id, desired, app.id));
      await runner.stop(managed.id);
      updateStatusBar();
      if (await waitPortFree(desired)) {
        output.appendLine(t('log.portFreedByStop', managed.id, desired));
        return desired;
      }
      void vscode.window.showErrorMessage(
        t('msg.portStillUsedAfterStop', managed.id, desired)
      );
      return null;
    }
    return resolvePortChoice(toPortChoice(choice, buttons), app, desired);
  }

  const owners = await findPortOwners(desired);
  if (owners.length === 0) {
    output.appendLine(t('log.portOwnerUnknown', desired));
    const buttons = portButtons();
    const choice = await vscode.window.showWarningMessage(
      t('msg.portUsedUnknownOwner', app.id, desired),
      buttons.auto,
      buttons.keep,
      buttons.cancel
    );
    return resolvePortChoice(toPortChoice(choice, buttons), app, desired);
  }

  const buttons = portButtons();
  const killAndStart = t('button.killAndStart');
  const choice = await vscode.window.showWarningMessage(
    t('msg.portUsedAskKill', app.id, desired),
    { modal: true, detail: describePortOwners(owners) },
    killAndStart,
    buttons.auto,
    buttons.keep,
    buttons.cancel
  );
  if (choice === killAndStart) {
    if (!(await killOwnersAndWait(desired, owners))) {
      return null;
    }
    return desired;
  }
  return resolvePortChoice(toPortChoice(choice, buttons), app, desired);
}

/** 独立命令：查询任意端口的占用者并结束（不启动任何应用） */
async function releasePort(arg?: unknown): Promise<void> {
  const ownerApp = arg instanceof AppTreeItem ? arg.app : undefined;
  let suggested: number | undefined;
  if (ownerApp) {
    const pref = store.get(ownerApp.id);
    const profile = resolveProfile(ownerApp, pref);
    suggested =
      runner.getRuntime(ownerApp.id).port ?? resolvePortValue(ownerApp, profile, pref);
  }

  const input = await vscode.window.showInputBox({
    prompt: t('prompt.releasePort'),
    value: suggested !== undefined ? String(suggested) : '',
    validateInput: (value) => {
      const port = Number(value.trim());
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return t('validate.port');
      }
      return undefined;
    }
  });
  if (input === undefined) {
    return;
  }
  const port = Number(input.trim());

  if (await isPortFree(port)) {
    void vscode.window.showInformationMessage(t('msg.portAlreadyFree', port));
    return;
  }

  const managed = managedAppsStoppable() ? findManagedAppOnPort(port) : undefined;
  if (managed) {
    const stopIt = t('button.stopIt');
    const choice = await vscode.window.showWarningMessage(
      t('msg.portUsedByManagedSimple', port, managed.id),
      { modal: true },
      stopIt
    );
    if (choice !== stopIt) {
      return;
    }
    output.appendLine(t('log.portStoppingManaged', managed.id, port));
    await runner.stop(managed.id);
    updateStatusBar();
    if (await waitPortFree(port)) {
      void vscode.window.showInformationMessage(
        t('msg.portReleasedByStopping', port, managed.id)
      );
    } else {
      void vscode.window.showErrorMessage(t('msg.portStillUsedAfterStopSimple', managed.id, port));
    }
    return;
  }

  const owners = await findPortOwners(port);
  if (owners.length === 0) {
    void vscode.window.showWarningMessage(t('msg.portUsedUnknownOwnerSimple', port));
    return;
  }

  const killProcess = t('button.killProcess');
  const choice = await vscode.window.showWarningMessage(
    t('msg.confirmKillPort', port),
    { modal: true, detail: describePortOwners(owners) },
    killProcess
  );
  if (choice !== killProcess) {
    return;
  }
  const ok = await killOwnersAndWait(port, owners);
  if (ok) {
    void vscode.window.showInformationMessage(t('msg.portReleased', port));
  } else {
    void vscode.window.showErrorMessage(t('msg.portReleaseFailed', port));
  }
}

async function launch(
  app: BootApp,
  opts: { debug?: boolean; profile?: string; port?: number; clearPort?: boolean; silent?: boolean } = {}
): Promise<boolean> {
  const pref = store.get(app.id);
  const profile = opts.profile ?? pref.profile ?? defaultProfile(app.config);
  const effectivePref: AppPreference = {
    ...pref,
    port: opts.port ?? (opts.clearPort ? undefined : pref.port)
  };
  const port = await ensurePort(app, profile, effectivePref);
  if (port === null) {
    return false;
  }
  const spec: LaunchSpec = {
    app,
    profile,
    port,
    mainClass: pref.mainClass || app.mainClass,
    buildDependencies: pref.buildDependencies,
    coverage: pref.coverage,
    debug: !!opts.debug
  };
  const ok = await runner.launch(app, spec);
  if (ok) {
    // 只记住「与配置文件不同」的端口，避免换了 profile 还沿用上一个 profile 的端口
    const configured = resolvePortFromConfig(app.config, profile);
    await store.set(app.id, { profile, port: port === configured ? undefined : port });
    recomputeConflicts();
    provider.refresh();
    updateStatusBar();
    if (!opts.silent) {
      const url = appUrl(app);
      if (url) {
        void vscode.window.showInformationMessage(t('msg.startSuccess', app.id, url));
      }
    }
    return true;
  }
  return false;
}

/** 选择 profile（含手动输入）。取消返回 undefined。 */
async function pickProfile(app: BootApp, current: string): Promise<string | undefined> {
  const available = app.config.profiles.filter((p) => p !== '');
  const items: (vscode.QuickPickItem & { profile?: string; manual?: boolean })[] = available.map(
    (p) => ({
      label: p,
      description:
        p === current
          ? t('common.current')
          : p === defaultProfile(app.config)
            ? t('common.ymlDefault')
            : '',
      profile: p
    })
  );
  items.push({ label: t('quickPick.manualInput'), manual: true });
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t('quickPick.pickProfile', app.id),
    matchOnDescription: false
  });
  if (!picked) {
    return undefined;
  }
  if (!picked.manual) {
    return picked.profile ?? '';
  }
  const input = await vscode.window.showInputBox({
    prompt: t('prompt.springProfile'),
    value: current
  });
  return input === undefined ? undefined : input.trim();
}

async function runWithProfile(app: BootApp): Promise<void> {
  const pref = store.get(app.id);
  const profile = await pickProfile(app, resolveProfile(app, pref));
  if (profile === undefined) {
    return;
  }
  // 换 profile 时清掉记住的端口，让新 profile 的 yml 端口生效
  await launch(app, { profile, clearPort: true });
}

async function runWithPort(app: BootApp): Promise<void> {
  const pref = store.get(app.id);
  const profile = resolveProfile(app, pref);
  const current = resolvePortValue(app, profile, pref);
  const input = await vscode.window.showInputBox({
    prompt: t('prompt.inputPort', app.id),
    value: String(current),
    validateInput: (value) => {
      const port = Number(value);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return t('validate.port');
      }
      return undefined;
    }
  });
  if (input === undefined) {
    return;
  }
  await launch(app, { port: Number(input) });
}

function isJavaFqn(value: string): boolean {
  return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(value);
}

/** 选择主类：同模块扫描到的候选 + 手动输入。取消返回 undefined。 */
async function pickMainClass(app: BootApp, current: string): Promise<string | undefined> {
  const candidates = Array.from(
    new Set(apps.filter((a) => a.dir === app.dir).map((a) => a.mainClass))
  );
  if (!candidates.includes(current)) {
    candidates.unshift(current);
  }
  const items: (vscode.QuickPickItem & { mainClass?: string; manual?: boolean })[] =
    candidates.map((name) => ({
      label: name,
      description: [
        name === app.mainClass ? t('common.scannedMainClass') : '',
        name === current && name !== app.mainClass ? t('common.currentOverride') : ''
      ]
        .filter(Boolean)
        .join(' · '),
      mainClass: name
    }));
  items.push({ label: t('quickPick.manualInput'), manual: true });
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t('quickPick.pickMainClass', app.id),
    matchOnDescription: false
  });
  if (!picked) {
    return undefined;
  }
  if (!picked.manual) {
    return picked.mainClass ?? picked.label;
  }
  const input = await vscode.window.showInputBox({
    prompt: t('prompt.mainClass'),
    value: current,
    validateInput: (value) => {
      const text = value.trim();
      if (!text) {
        return t('validate.mainClassRequired');
      }
      return isJavaFqn(text) ? undefined : t('validate.mainClassFqn');
    }
  });
  return input === undefined ? undefined : input.trim();
}

function afterPreferenceChange(app: BootApp, detail: string): void {
  recomputeConflicts();
  provider.refresh();
  updateStatusBar();
  output.appendLine(t('log.preference', app.id, detail));
  const suffix =
    runner.getRuntime(app.id).state === 'running' ? t('common.takesEffectAfterRestart') : '';
  void vscode.window.showInformationMessage(t('msg.preferenceSaved', app.id, detail, suffix));
}

type EditField = 'profile' | 'port' | 'mainClass' | 'buildDependencies' | 'coverage';

/**
 * 编辑应用记住的启动配置（profile / 端口 / 主类 / -am）。
 * 只写 .vscode/web-boot.json，不启动进程；端口留空表示回到配置文件的端口。
 */
async function editPreferences(app: BootApp): Promise<void> {
  const pref = store.get(app.id);
  const profile = resolveProfile(app, pref);
  const port = resolvePortValue(app, profile, pref);
  const mainClass = pref.mainClass || app.mainClass;
  const globalBuildDeps = vscode.workspace
    .getConfiguration('webBoot')
    .get<boolean>('buildDependencies', true);
  const effectiveBuildDeps = pref.buildDependencies ?? globalBuildDeps;
  const globalCoverage = vscode.workspace.getConfiguration('webBoot').get<boolean>('coverage', false);
  const effectiveCoverage = pref.coverage ?? globalCoverage;

  const items: (vscode.QuickPickItem & { field: EditField })[] = [
    {
      label: '$(account) Profile',
      description: `${profile || t('common.default')}${pref.profile ? t('common.remembered') : ''}`,
      field: 'profile'
    },
    {
      label: t('label.port'),
      description: `${port}${pref.port === undefined ? t('common.fromConfigFile') : t('common.override')}`,
      field: 'port'
    },
    {
      label: t('label.mainClass'),
      description: `${mainClass}${pref.mainClass ? t('common.override') : t('common.scanned')}`,
      field: 'mainClass'
    },
    {
      label: t('label.buildDependencies'),
      description: `${effectiveBuildDeps ? t('common.useAm') : t('common.noAm')}${
        pref.buildDependencies === undefined ? t('common.followGlobalMark') : t('common.override')
      }`,
      field: 'buildDependencies'
    },
    {
      label: t('label.coverage'),
      description: `${effectiveCoverage ? t('common.enabled') : t('common.disabled')}${
        pref.coverage === undefined ? t('common.followGlobalMark') : t('common.override')
      }`,
      field: 'coverage'
    }
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t('quickPick.editPreferences', app.id)
  });
  if (!picked) {
    return;
  }

  if (picked.field === 'profile') {
    const next = await pickProfile(app, profile);
    if (next === undefined || next === profile) {
      return;
    }
    // 换 profile 时清掉端口覆盖，让新 profile 的 yml 端口生效
    const cleared = pref.port === undefined ? '' : t('common.portOverrideCleared');
    await store.set(app.id, { profile: next, port: undefined });
    afterPreferenceChange(app, t('detail.profile', next || t('common.default'), cleared));
    return;
  }

  if (picked.field === 'port') {
    const configPort = resolvePortFromConfig(app.config, profile);
    const input = await vscode.window.showInputBox({
      prompt: t('prompt.inputPortWithConfig', app.id, configPort),
      value: String(port),
      validateInput: (value) => {
        const text = value.trim();
        if (!text) {
          return undefined;
        }
        const num = Number(text);
        if (!Number.isInteger(num) || num <= 0 || num > 65535) {
          return t('validate.portOrEmpty');
        }
        return undefined;
      }
    });
    if (input === undefined) {
      return;
    }
    const text = input.trim();
    const next = text ? Number(text) : undefined;
    // 与配置文件一致时不写覆盖，之后换 profile 能自然跟随 yml
    await store.set(app.id, {
      port: next === undefined || next === configPort ? undefined : next
    });
    afterPreferenceChange(
      app,
      t(
        'detail.port',
        next ?? configPort,
        next === undefined || next === configPort ? t('common.fromConfigFile') : t('common.override')
      )
    );
    return;
  }

  if (picked.field === 'buildDependencies') {
    const items: (vscode.QuickPickItem & { value?: boolean; follow?: boolean })[] = [
      {
        label: t('label.followGlobal'),
        description: t(
          'common.currentGlobal',
          globalBuildDeps ? t('common.useAm') : t('common.noAm')
        ),
        follow: true
      },
      {
        label: t('label.useAm'),
        description: `${t('common.useAmDesc')}${
          pref.buildDependencies === true ? t('common.currentMark') : ''
        }`,
        value: true
      },
      {
        label: t('label.noAm'),
        description: `${t('common.noAmDesc')}${
          pref.buildDependencies === false ? t('common.currentMark') : ''
        }`,
        value: false
      }
    ];
    const choice = await vscode.window.showQuickPick(items, {
      placeHolder: t('quickPick.setBuildDependencies', app.id)
    });
    if (!choice) {
      return;
    }
    const value = choice.follow ? undefined : choice.value;
    if (value === pref.buildDependencies) {
      return;
    }
    await store.set(app.id, { buildDependencies: value });
    afterPreferenceChange(
      app,
      value === undefined
        ? globalBuildDeps
          ? t('detail.buildDepsFollowGlobalUse')
          : t('detail.buildDepsFollowGlobalNo')
        : value
          ? t('detail.buildDepsUseOverride')
          : t('detail.buildDepsNoOverride')
    );
    return;
  }

  if (picked.field === 'coverage') {
    const items: (vscode.QuickPickItem & { value?: boolean; follow?: boolean })[] = [
      {
        label: t('label.followGlobal'),
        description: t(
          'common.currentGlobal',
          globalCoverage ? t('common.enabled') : t('common.disabled')
        ),
        follow: true
      },
      {
        label: t('label.enableCoverage'),
        description: `${t('common.enableCoverageDesc')}${
          pref.coverage === true ? t('common.currentMark') : ''
        }`,
        value: true
      },
      {
        label: t('label.disableCoverage'),
        description: `${t('common.disableCoverageDesc')}${
          pref.coverage === false ? t('common.currentMark') : ''
        }`,
        value: false
      }
    ];
    const choice = await vscode.window.showQuickPick(items, {
      placeHolder: t('quickPick.setCoverage', app.id)
    });
    if (!choice) {
      return;
    }
    const value = choice.follow ? undefined : choice.value;
    if (value === pref.coverage) {
      return;
    }
    await store.set(app.id, { coverage: value });
    afterPreferenceChange(
      app,
      value === undefined
        ? t(
            'detail.coverageFollowGlobal',
            globalCoverage ? t('common.enabled') : t('common.disabled')
          )
        : value
          ? t('detail.coverageEnabledOverride')
          : t('detail.coverageDisabledOverride')
    );
    return;
  }

  const next = await pickMainClass(app, mainClass);
  if (next === undefined) {
    return;
  }
  await store.set(app.id, { mainClass: next === app.mainClass ? undefined : next });
  afterPreferenceChange(
    app,
    t('detail.mainClass', next, next === app.mainClass ? t('common.scanned') : t('common.override'))
  );
}

async function promptGroupName(
  prompt: string,
  value: string,
  currentName?: string
): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    prompt,
    value,
    validateInput: (text) => {
      const name = text.trim();
      if (!name) {
        return t('validate.groupNameRequired');
      }
      const exists = store.getGroups().some(
        (g) => g.name.toLowerCase() === name.toLowerCase() && g.name !== currentName
      );
      return exists ? t('validate.groupNameExists') : undefined;
    }
  });
  return input === undefined ? undefined : input.trim();
}

async function createGroup(): Promise<void> {
  const name = await promptGroupName(t('prompt.newGroupName'), '');
  if (!name) {
    return;
  }
  await store.createGroup(name);
  provider.refresh();
  output.appendLine(t('log.groupCreated', name));
  void vscode.window.showInformationMessage(t('msg.groupCreated', name));
}

async function renameGroup(item: GroupTreeItem): Promise<void> {
  if (!item.groupName) {
    return;
  }
  const name = await promptGroupName(
    t('prompt.renameGroup', item.groupName),
    item.groupName,
    item.groupName
  );
  if (name === undefined || name === item.groupName) {
    return;
  }
  await store.renameGroup(item.groupName, name);
  provider.refresh();
  output.appendLine(t('log.groupRenamed', item.groupName, name));
}

async function deleteGroup(item: GroupTreeItem): Promise<void> {
  if (!item.groupName) {
    return;
  }
  const deleteButton = t('button.delete');
  const choice = await vscode.window.showWarningMessage(
    t('msg.confirmDeleteGroup', item.groupName, item.apps.length),
    { modal: true },
    deleteButton
  );
  if (choice !== deleteButton) {
    return;
  }
  await store.deleteGroup(item.groupName);
  provider.refresh();
  output.appendLine(t('log.groupDeleted', item.groupName));
}

async function moveAppToGroup(app: BootApp): Promise<void> {
  const current = store.groupOf(app.id);
  const items: (vscode.QuickPickItem & { target?: string; none?: boolean; create?: boolean })[] = [
    { label: t('label.ungrouped'), description: current ? '' : t('common.current'), none: true },
    ...store.getGroups().map((g) => ({
      label: `$(folder) ${g.name}`,
      description: g.name === current ? t('common.current') : '',
      target: g.name
    })),
    { label: t('label.newGroup'), create: true }
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t('quickPick.moveToGroup', app.id)
  });
  if (!picked) {
    return;
  }

  let target = picked.none ? undefined : picked.target;
  if (picked.create) {
    const name = await promptGroupName(t('prompt.newGroupName'), '');
    if (!name) {
      return;
    }
    await store.createGroup(name);
    target = name;
  }
  if (target === current) {
    return;
  }
  await store.assignApps([app.id], target);
  provider.refresh();
  output.appendLine(
    target ? t('log.appMovedToGroup', app.id, target) : t('log.appMovedToUngrouped', app.id)
  );
}

async function assignAppsToGroup(appIds: string[], groupName: string | undefined): Promise<void> {
  if (!groupName && store.getGroups().length === 0) {
    // 未启用分组时拖拽没有意义，也避免往配置里写空 groups
    return;
  }
  await store.assignApps(appIds, groupName);
  provider.refresh();
  output.appendLine(
    groupName
      ? t('log.appMovedToGroup', appIds.join(', '), groupName)
      : t('log.appMovedToUngrouped', appIds.join(', '))
  );
}

async function startGroup(item: GroupTreeItem, debug = false): Promise<void> {
  if (!item.groupName) {
    return;
  }
  const action = debug ? t('group.actionDebug') : t('group.actionStart');
  if (item.apps.length === 0) {
    void vscode.window.showInformationMessage(t('msg.groupEmpty', item.groupName));
    return;
  }
  const toStart = item.apps.filter(
    (app) => runner.getRuntime(app.id).state === 'stopped'
  );
  if (toStart.length === 0) {
    void vscode.window.showInformationMessage(t('msg.groupAllRunning', item.groupName));
    return;
  }

  output.appendLine(
    t('group.startingGroup', action, item.groupName, toStart.map((a) => a.id).join(', '))
  );
  for (const app of toStart) {
    const ok = await launch(app, { debug, silent: true });
    if (!ok) {
      output.appendLine(t('group.aborted', app.id, action));
      void vscode.window.showWarningMessage(t('msg.groupAborted', item.groupName, action, app.id));
      return;
    }
  }
  void vscode.window.showInformationMessage(t('msg.groupStarted', item.groupName, toStart.length));
}

async function stopGroup(item: GroupTreeItem): Promise<void> {
  if (!item.groupName) {
    return;
  }
  const running = item.apps.filter((app) => {
    const state = runner.getRuntime(app.id).state;
    return state === 'running' || state === 'starting' || state === 'stopping';
  });
  if (running.length === 0) {
    void vscode.window.showInformationMessage(t('msg.groupNoRunning', item.groupName));
    return;
  }

  output.appendLine(
    t('group.stopping', item.groupName, running.map((a) => a.id).join(', '))
  );
  for (const app of running) {
    await stopApp(app);
  }
}

async function stopApp(app: BootApp): Promise<void> {
  await runner.stop(app.id);
  updateStatusBar();
}

/** 对运行中的应用执行 mvn process-resources，重新拷贝资源 */
async function reloadResources(app: BootApp): Promise<void> {
  if (runner.getRuntime(app.id).state !== 'running') {
    void vscode.window.showWarningMessage(t('msg.appNotRunningForResources', app.id));
    return;
  }
  const pref = store.get(app.id);
  const profile = resolveProfile(app, pref);
  const spec: LaunchSpec = {
    app,
    profile,
    port: resolvePortValue(app, profile, pref),
    mainClass: pref.mainClass || app.mainClass,
    buildDependencies: pref.buildDependencies,
    debug: false
  };
  const ok = await runner.processResources(app, spec);
  if (ok) {
    void vscode.window.showInformationMessage(t('msg.resourcesUpdated', app.id));
  }
}

/** 重启：先停止（若在运行），再按记住的配置启动；调试运行的应用仍以调试方式重启 */
async function restartApp(app: BootApp): Promise<void> {
  const runtime = runner.getRuntime(app.id);
  const wasDebug = runtime.debug;
  const runnerMode = vscode.workspace
    .getConfiguration('webBoot')
    .get<'outputChannel' | 'terminal'>('runner', 'outputChannel');

  if (runtime.state !== 'stopped') {
    if (runnerMode === 'terminal') {
      void vscode.window.showWarningMessage(t('msg.restartNotSupportedInTerminal'));
      return;
    }
    output.appendLine(t('log.restartStopping', app.id));
    await runner.stop(app.id);
    updateStatusBar();
  }

  output.appendLine(
    wasDebug ? t('log.restartStartingDebug', app.id) : t('log.restartStarting', app.id)
  );
  const ok = await launch(app, { debug: wasDebug, silent: true });
  if (ok) {
    const url = appUrl(app);
    if (url) {
      void vscode.window.showInformationMessage(t('msg.restartSuccess', app.id, url));
    }
  }
}

/** 计算应用访问地址（runtime 实际端口/contextPath 优先，回退配置值）；无法解析返回 undefined */
function appUrl(app: BootApp): string | undefined {
  const pref = store.get(app.id);
  const profile = resolveProfile(app, pref);
  const runtime = runner.getRuntime(app.id);
  const port = runtime.port ?? resolvePortValue(app, profile, pref);
  const contextPath = runtime.contextPath ?? resolveContextPath(app.config, profile);
  return buildUrl(port, contextPath);
}

async function openApp(app: BootApp): Promise<void> {
  const pref = store.get(app.id);
  const profile = resolveProfile(app, pref);
  const runtime = runner.getRuntime(app.id);
  const port = runtime.port ?? resolvePortValue(app, profile, pref);
  const contextPath = runtime.contextPath ?? resolveContextPath(app.config, profile);
  const url = buildUrl(port, contextPath);
  if (!url) {
    void vscode.window.showWarningMessage(t('msg.cannotResolveUrl', app.id));
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

async function copyCommand(app: BootApp): Promise<void> {
  const pref = store.get(app.id);
  const profile = resolveProfile(app, pref);
  const port = resolvePortValue(app, profile, pref);
  const spec: LaunchSpec = {
    app,
    profile,
    port,
    mainClass: pref.mainClass || app.mainClass,
    buildDependencies: pref.buildDependencies,
    debug: false
  };
  const text = runner.describe(spec);
  await vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage(t('msg.commandCopied', app.id));
}

async function checkPortConflicts(): Promise<void> {
  if (apps.length === 0) {
    await scanAndRefresh();
  }
  recomputeConflicts();
  output.show(true);
  output.appendLine('');
  output.appendLine(t('log.portConflictSection'));
  const targets: EffectiveTarget[] = apps.map((app) => {
    const pref = store.get(app.id);
    const profile = resolveProfile(app, pref);
    return {
      appId: app.id,
      profile,
      port: resolvePortValue(app, profile, pref),
      contextPath: resolveContextPath(app.config, profile)
    };
  });
  targets.sort((a, b) => a.port - b.port || a.appId.localeCompare(b.appId));
  for (const target of targets) {
    const conflict = conflictMap.get(target.appId);
    const flag = conflict ? t('log.portConflictFlag') : '';
    output.appendLine(
      `  ${String(target.port).padStart(5)}  ${target.appId.padEnd(28)} ${target.profile}${flag}`
    );
  }
  const groups = Array.from(new Set(Array.from(conflictMap.values())));
  if (groups.length === 0) {
    output.appendLine(t('log.noPortConflicts'));
    void vscode.window.showInformationMessage(t('msg.noPortConflicts'));
    return;
  }
  const summary = groups
    .map((g) => `${g.port}: ${g.appIds.join(', ')}`)
    .join(t('common.groupSeparator'));
  void vscode.window.showWarningMessage(t('msg.portConflictsFound', groups.length, summary));
}

async function generateLaunchJsonFile(): Promise<void> {
  if (apps.length === 0) {
    await scanAndRefresh();
  }
  const root = rootDir();
  const configs = buildLaunchConfigs(apps, {
    getPreference: (appId) => store.get(appId),
    resolveProfile,
    resolvePort: resolvePortValue
  });
  const result = writeLaunchJson(root, configs);
  const openFile = t('button.openFile');
  void vscode.window
    .showInformationMessage(
      t('msg.launchJsonWritten', result.file, configs.length, result.kept),
      openFile
    )
    .then((choice) => {
      if (choice === openFile) {
        void vscode.window.showTextDocument(vscode.Uri.file(result.file));
      }
    });
}

export function activate(context: vscode.ExtensionContext): void {
  // 先确定语言，后面所有文案（包括输出通道名之外的内容）都依赖它
  initI18n(
    vscode.env.language,
    vscode.workspace.getConfiguration('webBoot').get<string>('language', 'auto')
  );
  output = vscode.window.createOutputChannel('Web Boot');
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  store = new PreferenceStore(root);
  runner = new BootRunner(root, output);

  provider = new AppsTreeProvider(
    (appId) => runner.getRuntime(appId),
    (appId) => store.get(appId),
    (appId) => conflictMap.get(appId),
    resolveProfile,
    resolvePortValue,
    () => store.getGroups()
  );

  treeView = vscode.window.createTreeView<WebBootTreeItem>('webBoot.apps', {
    treeDataProvider: provider,
    showCollapseAll: true,
    dragAndDropController: new AppsDragAndDropController((appIds, groupName) => {
      void assignAppsToGroup(appIds, groupName);
    })
  });

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  statusItem.command = 'webBoot.apps.focus';
  statusItem.show();

  const register = (command: string, callback: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };

  register('webBoot.refresh', () => scanAndRefresh());
  register('webBoot.run', async (arg) => {
    const app = await pickApp(arg);
    if (app) {
      await launch(app);
    }
  });
  register('webBoot.runWithProfile', async (arg) => {
    const app = await pickApp(arg);
    if (app) {
      await runWithProfile(app);
    }
  });
  register('webBoot.runWithPort', async (arg) => {
    const app = await pickApp(arg);
    if (app) {
      await runWithPort(app);
    }
  });
  register('webBoot.edit', async (arg) => {
    const app = await pickApp(arg);
    if (app) {
      await editPreferences(app);
    }
  });
  register('webBoot.createGroup', () => createGroup());
  register('webBoot.renameGroup', async (arg) => {
    if (arg instanceof GroupTreeItem) {
      await renameGroup(arg);
    }
  });
  register('webBoot.deleteGroup', async (arg) => {
    if (arg instanceof GroupTreeItem) {
      await deleteGroup(arg);
    }
  });
  register('webBoot.moveAppToGroup', async (arg) => {
    const app = await pickApp(arg);
    if (app) {
      await moveAppToGroup(app);
    }
  });
  register('webBoot.startGroup', async (arg) => {
    if (arg instanceof GroupTreeItem) {
      await startGroup(arg);
    }
  });
  register('webBoot.debugGroup', async (arg) => {
    if (arg instanceof GroupTreeItem) {
      await startGroup(arg, true);
    }
  });
  register('webBoot.stopGroup', async (arg) => {
    if (arg instanceof GroupTreeItem) {
      await stopGroup(arg);
    }
  });
  register('webBoot.debug', async (arg) => {
    const app = await pickApp(arg);
    if (app) {
      await launch(app, { debug: true });
    }
  });
  register('webBoot.stop', async (arg) => {
    const app = await pickApp(arg, true);
    if (app) {
      await stopApp(app);
    }
  });
  register('webBoot.restart', async (arg) => {
    const app = await pickApp(arg);
    if (app) {
      await restartApp(app);
    }
  });
  register('webBoot.processResources', async (arg) => {
    const app = await pickApp(arg);
    if (app) {
      await reloadResources(app);
    }
  });
  register('webBoot.sampleCoverage', async (arg) => {
    const app = await pickApp(arg);
    if (app) {
      await runner.sampleCoverage(app.id);
    }
  });
  register('webBoot.openCoverageReport', async (arg) => {
    const app = await pickApp(arg);
    if (!app) {
      return;
    }
    const file = runner.coverageReportFile(app.id);
    if (!file) {
      void vscode.window.showWarningMessage(t('msg.noCoverageReport', app.id));
      return;
    }
    await vscode.env.openExternal(vscode.Uri.file(file));
  });
  register('webBoot.open', async (arg) => {
    const app = await pickApp(arg);
    if (app) {
      await openApp(app);
    }
  });
  register('webBoot.copyCommand', async (arg) => {
    const app = await pickApp(arg);
    if (app) {
      await copyCommand(app);
    }
  });
  register('webBoot.checkPortConflicts', () => checkPortConflicts());
  register('webBoot.killPort', (arg) => releasePort(arg));
  register('webBoot.generateLaunchJson', () => generateLaunchJsonFile());
  register('webBoot.showOutput', () => output.show(true));

  context.subscriptions.push(
    output,
    runner,
    treeView,
    statusItem,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('webBoot.language')) {
        initI18n(
          vscode.env.language,
          vscode.workspace.getConfiguration('webBoot').get<string>('language', 'auto')
        );
        // 重扫一次让 reactorNote 等扫描期文案也换成新语言
        scheduleRefresh();
      }
      if (e.affectsConfiguration('webBoot')) {
        recomputeConflicts();
        provider.refresh();
        updateStatusBar();
      }
    }),
    runner.onDidChangeState(() => {
      provider.refresh();
      updateStatusBar();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => scheduleRefresh())
  );

  // 监听 pom.xml 与 application*.yml，改配置后自动重扫
  const watcher = vscode.workspace.createFileSystemWatcher('**/{pom.xml,application*.yml,application*.yaml}');
  watcher.onDidChange(() => scheduleRefresh());
  watcher.onDidCreate(() => scheduleRefresh());
  watcher.onDidDelete(() => scheduleRefresh());
  context.subscriptions.push(watcher);

  void scanAndRefresh().then(() => {
    if (apps.length === 0) {
      output.appendLine(t('log.noAppsHint'));
    }
  });
}

export async function deactivate(): Promise<void> {
  // 关闭窗口时清理子进程，避免 java 残留占用端口
  if (runner) {
    await runner.stopAll();
    runner.dispose();
  }
}
