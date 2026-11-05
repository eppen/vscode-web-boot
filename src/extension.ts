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
import { AppTreeItem, AppsTreeProvider } from './views/appsTreeProvider';
import {
  computeConflicts,
  findFreePort,
  isPortFree,
  type EffectiveTarget,
  type PortConflict
} from './util/ports';
import { buildLaunchConfigs, writeLaunchJson } from './commands/generateLaunchJson';
import { buildUrl } from './runner/command';
import type { AppPreference, BootApp, LaunchSpec } from './model/types';

let output: vscode.OutputChannel;
let runner: BootRunner;
let store: PreferenceStore;
let provider: AppsTreeProvider;
let statusItem: vscode.StatusBarItem;
let apps: BootApp[] = [];
let conflictMap = new Map<string, PortConflict>();
let refreshTimer: NodeJS.Timeout | undefined;

function rootDir(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('请先打开包含 pom.xml 的工作区根目录');
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

function updateStatusBar(): void {
  const running = apps.filter((a) => runner.getRuntime(a.id).state === 'running').length;
  const starting = apps.filter((a) => runner.getRuntime(a.id).state === 'starting').length;
  if (running > 0 || starting > 0) {
    statusItem.text = `$(circle-filled) Web Boot ${running} 运行中${starting ? ` / ${starting} 启动中` : ''}`;
  } else {
    statusItem.text = `$(circle-outline) Web Boot ${apps.length} 应用`;
  }
  statusItem.tooltip = '点击定位到 Web Boot 视图';
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
      `[扫描] ${root}：reactor 模块 ${reactor.size} 个，可启动应用 ${apps.length} 个，端口冲突 ${new Set(conflictMap.keys()).size} 个应用受影响。`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output.appendLine(`[扫描失败] ${message}`);
    void vscode.window.showErrorMessage(`Web Boot 扫描失败：${message}`);
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
      void vscode.window.showInformationMessage('当前没有正在运行的应用。');
    } else {
      void vscode.window.showWarningMessage('未发现可启动的 Spring Boot 应用。');
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
        description: `${profile || '(无 profile)'} · :${port}${a.inReactor ? '' : ' · 不在 reactor'}`,
        detail: a.relDir,
        app: a
      };
    }),
    { placeHolder: runningOnly ? '选择要停止的应用' : '选择要启动的应用', matchOnDetail: true }
  );
  return picked?.app;
}

/**
 * 启动前确认端口可用。返回 null 表示用户取消。
 * 端口被占用时给三个选项：自动换端口 / 仍用该端口 / 取消。
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
    void vscode.window.showWarningMessage(`${app.id} 已在运行。`);
    return null;
  }
  const choice = await vscode.window.showWarningMessage(
    `${app.id} 配置的端口 ${desired} 已被占用。`,
    { modal: false },
    '自动换端口',
    '仍用该端口',
    '取消'
  );
  if (choice === '自动换端口') {
    const free = await findFreePort(desired + 1);
    output.appendLine(`[端口] ${app.id} 由 ${desired} 改为 ${free}。`);
    return free;
  }
  if (choice === '仍用该端口') {
    return desired;
  }
  return null;
}

async function launch(
  app: BootApp,
  opts: { debug?: boolean; profile?: string; port?: number; clearPort?: boolean } = {}
): Promise<void> {
  const pref = store.get(app.id);
  const profile = opts.profile ?? pref.profile ?? defaultProfile(app.config);
  const effectivePref: AppPreference = {
    ...pref,
    port: opts.port ?? (opts.clearPort ? undefined : pref.port)
  };
  const port = await ensurePort(app, profile, effectivePref);
  if (port === null) {
    return;
  }
  const spec: LaunchSpec = { app, profile, port, debug: !!opts.debug };
  const ok = await runner.launch(app, spec);
  if (ok) {
    // 只记住「与配置文件不同」的端口，避免换了 profile 还沿用上一个 profile 的端口
    const configured = resolvePortFromConfig(app.config, profile);
    await store.set(app.id, { profile, port: port === configured ? undefined : port });
    recomputeConflicts();
    provider.refresh();
    updateStatusBar();
  }
}

/** 选择 profile（含手动输入）。取消返回 undefined。 */
async function pickProfile(app: BootApp, current: string): Promise<string | undefined> {
  const available = app.config.profiles.filter((p) => p !== '');
  const items: (vscode.QuickPickItem & { profile?: string; manual?: boolean })[] = available.map(
    (p) => ({
      label: p,
      description: p === current ? '当前' : p === defaultProfile(app.config) ? 'application.yml 默认' : '',
      profile: p
    })
  );
  items.push({ label: '$(edit) 手动输入...', manual: true });
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `选择 ${app.id} 的 profile`,
    matchOnDescription: false
  });
  if (!picked) {
    return undefined;
  }
  if (!picked.manual) {
    return picked.profile ?? '';
  }
  const input = await vscode.window.showInputBox({
    prompt: 'Spring profile（多个用逗号分隔）',
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
    prompt: `输入 ${app.id} 的监听端口`,
    value: String(current),
    validateInput: (value) => {
      const port = Number(value);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return '请输入 1 - 65535 之间的整数';
      }
      return undefined;
    }
  });
  if (input === undefined) {
    return;
  }
  await launch(app, { port: Number(input) });
}

/**
 * 编辑应用记住的 profile 与端口，只写 .vscode/web-boot.json，不启动进程。
 * 端口留空表示清除覆盖，回到 profile 对应配置文件的端口。
 */
async function editPreferences(app: BootApp): Promise<void> {
  const pref = store.get(app.id);
  const currentProfile = resolveProfile(app, pref);

  const profile = await pickProfile(app, currentProfile);
  if (profile === undefined) {
    return;
  }

  const configPort = resolvePortFromConfig(app.config, profile);
  // 换了 profile，旧端口覆盖不再适用，改用新 profile 的配置端口作为默认值
  const currentPort =
    profile === currentProfile ? resolvePortValue(app, profile, pref) : configPort;
  const input = await vscode.window.showInputBox({
    prompt: `输入 ${app.id} 的监听端口（留空使用配置文件中的 ${configPort}）`,
    value: String(currentPort),
    validateInput: (value) => {
      const text = value.trim();
      if (!text) {
        return undefined;
      }
      const port = Number(text);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return '请输入 1 - 65535 之间的整数，或留空使用配置文件端口';
      }
      return undefined;
    }
  });
  if (input === undefined) {
    return;
  }

  const text = input.trim();
  const port = text ? Number(text) : undefined;
  // 与配置文件一致时不写覆盖，之后换 profile 能自然跟随 yml
  await store.set(app.id, {
    profile,
    port: port === undefined || port === configPort ? undefined : port
  });

  recomputeConflicts();
  provider.refresh();
  updateStatusBar();

  const effective = port ?? configPort;
  const note = port === undefined || port === configPort ? '（来自配置文件）' : '（覆盖）';
  const detail = `profile ${profile || '(默认)'} · :${effective}${note}`;
  output.appendLine(`[偏好] ${app.id}: ${detail}`);
  const suffix = runner.getRuntime(app.id).state === 'running' ? '，重启后生效' : '';
  void vscode.window.showInformationMessage(`${app.id} 偏好已保存：${detail}${suffix}。`);
}

async function stopApp(app: BootApp): Promise<void> {
  await runner.stop(app.id);
  updateStatusBar();
}

async function openApp(app: BootApp): Promise<void> {
  const pref = store.get(app.id);
  const profile = resolveProfile(app, pref);
  const runtime = runner.getRuntime(app.id);
  const port = runtime.port ?? resolvePortValue(app, profile, pref);
  const contextPath = runtime.contextPath ?? resolveContextPath(app.config, profile);
  const url = buildUrl(port, contextPath);
  if (!url) {
    void vscode.window.showWarningMessage(`无法确定 ${app.id} 的访问地址。`);
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

async function copyCommand(app: BootApp): Promise<void> {
  const pref = store.get(app.id);
  const profile = resolveProfile(app, pref);
  const port = resolvePortValue(app, profile, pref);
  const spec: LaunchSpec = { app, profile, port, debug: false };
  const text = runner.describe(spec);
  await vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage(`已复制 ${app.id} 的启动命令。`);
}

async function checkPortConflicts(): Promise<void> {
  if (apps.length === 0) {
    await scanAndRefresh();
  }
  recomputeConflicts();
  output.show(true);
  output.appendLine('');
  output.appendLine('===== 端口冲突检查 =====');
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
    const flag = conflict ? '  <-- 冲突' : '';
    output.appendLine(
      `  ${String(target.port).padStart(5)}  ${target.appId.padEnd(28)} ${target.profile}${flag}`
    );
  }
  const groups = Array.from(new Set(Array.from(conflictMap.values())));
  if (groups.length === 0) {
    output.appendLine('  未发现端口冲突。');
    void vscode.window.showInformationMessage('未发现端口冲突。');
    return;
  }
  const summary = groups
    .map((g) => `${g.port}: ${g.appIds.join(', ')}`)
    .join('；');
  void vscode.window.showWarningMessage(`发现 ${groups.length} 组端口冲突 —— ${summary}`);
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
  void vscode.window
    .showInformationMessage(
      `已写入 ${result.file}（更新 ${configs.length} 条 Web Boot 配置，保留其它 ${result.kept} 条）。`,
      '打开文件'
    )
    .then((choice) => {
      if (choice === '打开文件') {
        void vscode.window.showTextDocument(vscode.Uri.file(result.file));
      }
    });
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Web Boot');
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  store = new PreferenceStore(root);
  runner = new BootRunner(root, output);

  provider = new AppsTreeProvider(
    (appId) => runner.getRuntime(appId),
    (appId) => store.get(appId),
    (appId) => conflictMap.get(appId),
    resolveProfile,
    resolvePortValue
  );

  const treeView = vscode.window.createTreeView('webBoot.apps', {
    treeDataProvider: provider,
    showCollapseAll: false
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
  register('webBoot.generateLaunchJson', () => generateLaunchJsonFile());
  register('webBoot.showOutput', () => output.show(true));

  context.subscriptions.push(
    output,
    runner,
    treeView,
    statusItem,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('webBoot')) {
        recomputeConflicts();
        provider.refresh();
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
      output.appendLine('[提示] 未发现可启动应用，请确认工作区根目录为 mes-parent。');
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
