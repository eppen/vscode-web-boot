/**
 * 侧边栏树：每个节点是一个可启动的 Spring Boot 应用。
 *
 * 支持手动分组：分组按 .vscode/web-boot.json 中的顺序展示，应用可拖入/拖出分组。
 * 节点上要能一眼看出三件事：用哪个 profile、占哪个端口、是否在 reactor 内。
 * 端口冲突用警告图标提示（本仓库四个 web 模块默认都是 8080）。
 */
import * as path from 'path';
import * as vscode from 'vscode';
import type {
  AppGroup,
  AppMetrics,
  AppPreference,
  AppRuntime,
  AppState,
  BootApp,
  CoverageState
} from '../model/types';
import type { PortConflict } from '../util/ports';
import { buildUrl } from '../runner/command';
import { t } from '../i18n';

const STATE_ICON: Record<string, vscode.ThemeIcon> = {
  stopped: new vscode.ThemeIcon('circle-outline'),
  starting: new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow')),
  running: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green')),
  stopping: new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.orange'))
};

/** 状态文案。做成函数而不是常量表，切换语言后无需重新加载模块。 */
function stateLabel(state: AppState | string): string {
  switch (state) {
    case 'stopped':
      return t('state.stopped');
    case 'starting':
      return t('state.starting');
    case 'running':
      return t('state.running');
    case 'stopping':
      return t('state.stopping');
    default:
      return String(state);
  }
}

export class AppTreeItem extends vscode.TreeItem {
  readonly kind = 'app' as const;

  constructor(
    public readonly app: BootApp,
    public readonly runtime: AppRuntime,
    public readonly profile: string,
    public readonly port: number,
    public readonly conflict?: PortConflict,
    public readonly mainClass: string = app.mainClass,
    /** 挂载在哪个分组下；undefined 表示未分组 */
    public readonly groupName?: string
  ) {
    super(app.id, vscode.TreeItemCollapsibleState.None);
    this.id = `app:${app.id}`;

    const contextPath = runtime.contextPath ?? app.config.contextPaths[profile] ?? app.config.baseContextPath;
    const stateText = stateLabel(runtime.state);
    const parts = [profile || t('common.noProfile'), `:${port}`];
    if (contextPath) {
      parts.push(contextPath);
    }
    if (runtime.state === 'running') {
      parts.push(t('state.running'));
    } else if (runtime.state === 'starting' || runtime.state === 'stopping') {
      parts.push(stateText);
    }
    const metricsSummary = formatMetricsSummary(runtime.metrics);
    if (metricsSummary) {
      parts.push(metricsSummary);
    }
    const coverageSummary = formatCoverageSummary(runtime.coverage);
    if (coverageSummary) {
      parts.push(coverageSummary);
    }
    this.description = parts.join('  ');

    this.iconPath = STATE_ICON[runtime.state] ?? STATE_ICON.stopped;
    this.contextValue = `bootApp.${runtime.state}`;
    this.tooltip = buildTooltip(app, runtime, profile, port, contextPath, conflict, mainClass);

    if (runtime.state === 'running') {
      const url = buildUrl(runtime.port ?? port, contextPath);
      this.command = url
        ? { command: 'webBoot.open', title: t('command.openInBrowser'), arguments: [this] }
        : undefined;
    } else if (runtime.state === 'stopped') {
      this.command = { command: 'webBoot.run', title: t('command.run'), arguments: [this] };
    }
  }
}

/** 分组节点；groupName 为 undefined 时是虚拟的「未分组」桶 */
export class GroupTreeItem extends vscode.TreeItem {
  readonly kind = 'group' as const;

  constructor(
    public readonly groupName: string | undefined,
    public readonly apps: BootApp[],
    public readonly conflictPorts: number[] = []
  ) {
    super(
      groupName ?? t('group.ungrouped'),
      apps.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    this.id = groupName ? `group:real:${groupName}` : 'group:virtual:ungrouped';
    this.description =
      t('group.appCount', apps.length) +
      (conflictPorts.length > 0 ? t('group.conflictSuffix', conflictPorts.length) : '');
    this.contextValue = groupName ? 'bootGroup' : 'bootGroup.ungrouped';
    this.iconPath = new vscode.ThemeIcon(
      conflictPorts.length > 0 ? 'warning' : groupName ? 'folder' : 'inbox',
      conflictPorts.length > 0 ? new vscode.ThemeColor('charts.yellow') : undefined
    );
    this.tooltip = buildGroupTooltip(groupName, apps, conflictPorts);
  }
}

export type WebBootTreeItem = AppTreeItem | GroupTreeItem;

function buildTooltip(
  app: BootApp,
  runtime: AppRuntime,
  profile: string,
  port: number,
  contextPath: string | undefined,
  conflict?: PortConflict,
  mainClass: string = app.mainClass
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${app.id}**\n\n`);
  md.appendMarkdown(`${t('tree.module', app.relDir)}\n`);
  md.appendMarkdown(
    `${t(
      'tree.mainClass',
      mainClass,
      mainClass !== app.mainClass ? t('common.override') : ''
    )}\n`
  );
  md.appendMarkdown(
    `${
      app.inReactor
        ? t('tree.inReactor')
        : t('tree.notInReactor', app.reactorNote ?? t('tree.undeclared'))
    }\n`
  );
  md.appendMarkdown(`${t('tree.profile', profile || t('common.noProfile'))}\n`);
  md.appendMarkdown(`${t('tree.port', port)}\n`);
  if (contextPath) {
    md.appendMarkdown(`${t('tree.contextPath', contextPath)}\n`);
  }
  if (app.config.profiles.filter((p) => p).length > 0) {
    md.appendMarkdown(
      `${t('tree.availableProfiles', app.config.profiles.filter((p) => p).join(', '))}\n`
    );
  }
  md.appendMarkdown(`${t('tree.state', stateLabel(runtime.state))}\n`);
  appendMetricsTooltip(md, runtime.metrics);
  appendCoverageTooltip(md, runtime.coverage);
  if (runtime.pid) {
    md.appendMarkdown(`${t('tree.pid', runtime.pid)}\n`);
  }
  if (conflict) {
    md.appendMarkdown(`\n${t('tree.portConflict', conflict.appIds.join(', '), conflict.port)}\n`);
  }
  if (runtime.lastCommand) {
    md.appendMarkdown(`\n${t('tree.lastCommand')}\n\n\`\`\`\n${runtime.lastCommand}\n\`\`\`\n`);
  }
  return md;
}

function formatMb(kilobytes: number): string {
  return `${(kilobytes / 1024).toFixed(0)}M`;
}

/** 树节点上的紧凑指标：堆 34% · HTTP 200 8ms，或 Tomcat 5/200 */
function formatMetricsSummary(metrics?: AppMetrics): string | undefined {
  if (!metrics) {
    return undefined;
  }
  const parts: string[] = [];
  if (metrics.jvm?.heapUsedPercent !== undefined) {
    parts.push(t('tree.heap', Math.round(metrics.jvm.heapUsedPercent)));
  }
  const tomcat = metrics.tomcat;
  if (tomcat) {
    if (!tomcat.ok) {
      parts.push(t('tree.httpUnreachable'));
    } else if (tomcat.busyThreads !== undefined && tomcat.maxThreads !== undefined) {
      parts.push(
        `Tomcat ${Math.round(tomcat.busyThreads)}/${Math.round(tomcat.maxThreads)}`
      );
    } else {
      parts.push(`HTTP ${tomcat.status ?? '?'} ${tomcat.latencyMs}ms`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function appendMetricsTooltip(md: vscode.MarkdownString, metrics?: AppMetrics): void {
  if (!metrics) {
    return;
  }
  if (metrics.jvm) {
    const jvm = metrics.jvm;
    const heap =
      jvm.heapUsedK !== undefined && jvm.heapCommittedK !== undefined
        ? jvm.heapUsedPercent !== undefined
          ? t(
              'tree.heapDetail',
              formatMb(jvm.heapUsedK),
              formatMb(jvm.heapCommittedK),
              Math.round(jvm.heapUsedPercent)
            )
          : t('tree.heapDetailNoPercent', formatMb(jvm.heapUsedK), formatMb(jvm.heapCommittedK))
        : t('tree.connected');
    const gc =
      jvm.ygc !== undefined
        ? t(
            'tree.gcDetail',
            jvm.ygc,
            (jvm.ygct ?? 0).toFixed(2),
            jvm.fgc ?? 0,
            (jvm.fgct ?? 0).toFixed(2)
          )
        : '';
    md.appendMarkdown(`${t('tree.jvmMetric', heap, gc)}\n`);
  } else if (metrics.jvmError) {
    md.appendMarkdown(`${t('tree.jvmUnavailable', metrics.jvmError)}\n`);
  }
  if (metrics.tomcat) {
    const tomcat = metrics.tomcat;
    const http = tomcat.ok
      ? t('tree.httpDetail', tomcat.status ?? '?', tomcat.latencyMs ?? 0)
      : tomcat.error
        ? t('tree.httpUnreachableDetail', tomcat.error)
        : t('tree.httpUnreachableNoReason');
    const threads =
      tomcat.busyThreads !== undefined
        ? tomcat.maxThreads !== undefined
          ? t('tree.threads', Math.round(tomcat.busyThreads), Math.round(tomcat.maxThreads))
          : t('tree.threadsNoMax', Math.round(tomcat.busyThreads))
        : '';
    md.appendMarkdown(`${t('tree.tomcat', http, threads)}\n`);
  }
  md.appendMarkdown(
    `${t('tree.metricsUpdated', new Date(metrics.updatedAt).toLocaleTimeString())}\n`
  );
}

/** 树节点上的紧凑覆盖率：JaCoCo · 覆盖 45.2%（行命中率） */
function formatCoverageSummary(coverage?: CoverageState): string | undefined {
  if (!coverage) {
    return undefined;
  }
  const parts: string[] = [];
  if (coverage.enabled) {
    parts.push('JaCoCo');
  }
  const rate = coverage.summary?.line.rate;
  if (rate !== undefined) {
    parts.push(t('tree.coverageSummary', rate.toFixed(1)));
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** 悬浮提示里的覆盖率详情：行 / 分支 / 类命中率、报告位置、最近错误 */
function appendCoverageTooltip(md: vscode.MarkdownString, coverage?: CoverageState): void {
  if (!coverage) {
    return;
  }
  if (coverage.enabled) {
    md.appendMarkdown(`${t('tree.coverageAttached', coverage.port ?? '?')}\n`);
  }
  const summary = coverage.summary;
  if (summary) {
    const line =
      summary.line.rate !== undefined
        ? t(
            'tree.rateWithRatio',
            summary.line.rate.toFixed(1),
            summary.line.covered,
            summary.line.covered + summary.line.missed
          )
        : '--';
    const branch = summary.branch.rate !== undefined ? `${summary.branch.rate.toFixed(1)}%` : '--';
    const clazz = summary.clazz.rate !== undefined ? `${summary.clazz.rate.toFixed(1)}%` : '--';
    md.appendMarkdown(`${t('tree.coverageRates', line, branch, clazz)}\n`);
    md.appendMarkdown(
      `${t('tree.coverageReportTime', new Date(summary.updatedAt).toLocaleString())}\n`
    );
  }
  if (coverage.reportDir) {
    md.appendMarkdown(`${t('tree.coverageReport', path.join(coverage.reportDir, 'index.html'))}\n`);
  }
  if (coverage.error) {
    md.appendMarkdown(`${t('tree.coverageError', coverage.error)}\n`);
  }
}

function buildGroupTooltip(
  groupName: string | undefined,
  apps: BootApp[],
  conflictPorts: number[]
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${groupName ?? t('group.ungrouped')}**\n\n`);
  md.appendMarkdown(`${t('tree.groupApps', apps.length)}\n`);
  if (apps.length > 0) {
    md.appendMarkdown(
      `${t(
        'tree.groupAppList',
        apps.map((a) => `\`${a.id}\``).join(t('common.listSeparator'))
      )}\n`
    );
  }
  if (conflictPorts.length > 0) {
    md.appendMarkdown(`${t('tree.groupConflicts', conflictPorts.join(', '))}\n`);
  }
  if (groupName) {
    md.appendMarkdown(`\n${t('tree.groupDragHint')}\n`);
  }
  return md;
}

export const APP_DRAG_MIME = 'application/vnd.code.tree.webboot.apps';

/** 应用拖入分组（或拖到「未分组」移出分组） */
export class AppsDragAndDropController
  implements vscode.TreeDragAndDropController<WebBootTreeItem>
{
  readonly dragMimeTypes = [APP_DRAG_MIME];
  readonly dropMimeTypes = [APP_DRAG_MIME];

  constructor(
    private readonly onDrop: (appIds: string[], groupName: string | undefined) => void
  ) {}

  handleDrag(source: readonly WebBootTreeItem[], dataTransfer: vscode.DataTransfer): void {
    const ids = source
      .filter((item): item is AppTreeItem => item instanceof AppTreeItem)
      .map((item) => item.app.id);
    if (ids.length > 0) {
      dataTransfer.set(APP_DRAG_MIME, new vscode.DataTransferItem(ids));
    }
  }

  handleDrop(
    target: WebBootTreeItem | undefined,
    dataTransfer: vscode.DataTransfer
  ): void {
    // 拖到分组标题或组内任意应用上都可以
    let groupName: string | undefined;
    if (target instanceof GroupTreeItem || target instanceof AppTreeItem) {
      groupName = target.groupName;
    } else {
      return;
    }
    const data = dataTransfer.get(APP_DRAG_MIME);
    const ids = data?.value as string[] | undefined;
    if (ids && ids.length > 0) {
      this.onDrop(ids, groupName);
    }
  }
}

export class AppsTreeProvider implements vscode.TreeDataProvider<WebBootTreeItem> {
  private apps: BootApp[] = [];
  private readonly emitter = new vscode.EventEmitter<WebBootTreeItem | undefined>();

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly getRuntime: (appId: string) => AppRuntime,
    private readonly getPreference: (appId: string) => AppPreference,
    private readonly getConflict: (appId: string) => PortConflict | undefined,
    private readonly resolveProfile: (app: BootApp, pref?: AppPreference) => string,
    private readonly resolvePort: (app: BootApp, profile: string, pref?: AppPreference) => number,
    private readonly getGroups: () => AppGroup[]
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

  getChildren(element?: WebBootTreeItem): WebBootTreeItem[] {
    if (element instanceof AppTreeItem) {
      return [];
    }
    if (element instanceof GroupTreeItem) {
      return element.apps.map((app) => this.createAppItem(app, element.groupName));
    }

    const groups = this.getGroups();
    if (groups.length === 0) {
      return this.apps.map((app) => this.createAppItem(app));
    }

    const items: WebBootTreeItem[] = groups.map((group) => this.createGroupItem(group));
    const assigned = new Set(groups.flatMap((g) => g.apps));
    const ungrouped = this.apps.filter((a) => !assigned.has(a.id));
    items.push(
      new GroupTreeItem(undefined, ungrouped, this.conflictPorts(ungrouped))
    );
    return items;
  }

  getTreeItem(element: WebBootTreeItem): vscode.TreeItem {
    return element;
  }

  private createAppItem(app: BootApp, groupName?: string): AppTreeItem {
    const pref = this.getPreference(app.id);
    const runtime = this.getRuntime(app.id);
    const profile = runtime.profile ?? this.resolveProfile(app, pref);
    const port = runtime.port ?? this.resolvePort(app, profile, pref);
    const mainClass = pref.mainClass || app.mainClass;
    return new AppTreeItem(
      app,
      runtime,
      profile,
      port,
      this.getConflict(app.id),
      mainClass,
      groupName
    );
  }

  private createGroupItem(group: AppGroup): GroupTreeItem {
    const byId = new Map(this.apps.map((app) => [app.id, app]));
    const apps = group.apps
      .map((id) => byId.get(id))
      .filter((app): app is BootApp => !!app)
      .sort((a, b) => a.id.localeCompare(b.id));
    return new GroupTreeItem(group.name, apps, this.conflictPorts(apps));
  }

  private conflictPorts(apps: BootApp[]): number[] {
    const ports = new Set<number>();
    for (const app of apps) {
      const conflict = this.getConflict(app.id);
      if (conflict) {
        ports.add(conflict.port);
      }
    }
    return Array.from(ports).sort((a, b) => a - b);
  }
}
