/**
 * 侧边栏树：每个节点是一个可启动的 Spring Boot 应用。
 *
 * 节点上要能一眼看出三件事：用哪个 profile、占哪个端口、是否在 reactor 内。
 * 端口冲突用警告图标提示（本仓库四个 web 模块默认都是 8080）。
 */
import * as vscode from 'vscode';
import type { AppPreference, AppRuntime, BootApp } from '../model/types';
import type { PortConflict } from '../util/ports';
import { buildUrl } from '../runner/command';

const STATE_ICON: Record<string, vscode.ThemeIcon> = {
  stopped: new vscode.ThemeIcon('circle-outline'),
  starting: new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow')),
  running: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green')),
  stopping: new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.orange'))
};

const STATE_LABEL: Record<string, string> = {
  stopped: '未运行',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中'
};

export class AppTreeItem extends vscode.TreeItem {
  constructor(
    public readonly app: BootApp,
    public readonly runtime: AppRuntime,
    public readonly profile: string,
    public readonly port: number,
    public readonly conflict?: PortConflict
  ) {
    super(app.id, vscode.TreeItemCollapsibleState.None);

    const contextPath = runtime.contextPath ?? app.config.contextPaths[profile] ?? app.config.baseContextPath;
    const stateText = STATE_LABEL[runtime.state] ?? runtime.state;
    const parts = [profile || '(无 profile)', `:${port}`];
    if (contextPath) {
      parts.push(contextPath);
    }
    if (runtime.state === 'running') {
      parts.push('运行中');
    } else if (runtime.state === 'starting' || runtime.state === 'stopping') {
      parts.push(stateText);
    }
    this.description = parts.join('  ');

    this.iconPath = STATE_ICON[runtime.state] ?? STATE_ICON.stopped;
    this.contextValue = `bootApp.${runtime.state}`;
    this.tooltip = buildTooltip(app, runtime, profile, port, contextPath, conflict);

    if (runtime.state === 'running') {
      const url = buildUrl(runtime.port ?? port, contextPath);
      this.command = url
        ? { command: 'webBoot.open', title: '在浏览器中打开', arguments: [this] }
        : undefined;
    } else if (runtime.state === 'stopped') {
      this.command = { command: 'webBoot.run', title: '运行', arguments: [this] };
    }
  }
}

function buildTooltip(
  app: BootApp,
  runtime: AppRuntime,
  profile: string,
  port: number,
  contextPath: string | undefined,
  conflict?: PortConflict
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${app.id}**\n\n`);
  md.appendMarkdown(`- 模块：\`${app.relDir}\`\n`);
  md.appendMarkdown(`- 启动类：\`${app.mainClass}\`\n`);
  md.appendMarkdown(
    `- reactor：${app.inReactor ? '是' : `否（${app.reactorNote ?? '未声明'}）`}\n`
  );
  md.appendMarkdown(`- profile：\`${profile || '(无)'}\`\n`);
  md.appendMarkdown(`- 端口：\`${port}\`\n`);
  if (contextPath) {
    md.appendMarkdown(`- context-path：\`${contextPath}\`\n`);
  }
  if (app.config.profiles.filter((p) => p).length > 0) {
    md.appendMarkdown(`- 可用 profile：${app.config.profiles.filter((p) => p).join(', ')}\n`);
  }
  md.appendMarkdown(`- 状态：${STATE_LABEL[runtime.state] ?? runtime.state}\n`);
  if (runtime.pid) {
    md.appendMarkdown(`- pid：\`${runtime.pid}\`\n`);
  }
  if (conflict) {
    md.appendMarkdown(`\n$(warning) **端口冲突**：${conflict.appIds.join(', ')} 都使用 ${conflict.port}\n`);
  }
  if (runtime.lastCommand) {
    md.appendMarkdown(`\n启动命令：\n\n\`\`\`\n${runtime.lastCommand}\n\`\`\`\n`);
  }
  return md;
}

export class AppsTreeProvider implements vscode.TreeDataProvider<AppTreeItem> {
  private apps: BootApp[] = [];
  private readonly emitter = new vscode.EventEmitter<AppTreeItem | undefined>();

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly getRuntime: (appId: string) => AppRuntime,
    private readonly getPreference: (appId: string) => AppPreference,
    private readonly getConflict: (appId: string) => PortConflict | undefined,
    private readonly resolveProfile: (app: BootApp, pref?: AppPreference) => string,
    private readonly resolvePort: (app: BootApp, profile: string, pref?: AppPreference) => number
  ) {}

  setApps(apps: BootApp[]): void {
    this.apps = apps;
    this.refresh();
  }

  getApps(): BootApp[] {
    return this.apps;
  }

  findApp(appId: string): BootApp | undefined {
    return this.apps.find((a) => a.id === appId);
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getChildren(element?: AppTreeItem): AppTreeItem[] {
    if (element) {
      return [];
    }
    return this.apps.map((app) => {
      const pref = this.getPreference(app.id);
      const runtime = this.getRuntime(app.id);
      const profile = runtime.profile ?? this.resolveProfile(app, pref);
      const port = runtime.port ?? this.resolvePort(app, profile, pref);
      return new AppTreeItem(app, runtime, profile, port, this.getConflict(app.id));
    });
  }

  getTreeItem(element: AppTreeItem): vscode.TreeItem {
    return element;
  }
}
