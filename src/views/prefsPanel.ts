/**
 * 参数面板（webview）：按分组把组内应用的 Profile / 端口 / 主类 / -am / 覆盖率
 * 列成一张表，改完点「保存」一次写回 .vscode/web-boot.json。
 *
 * 几个刻意取舍：
 * - HTML / CSS / JS 全部内联成字符串，靠 CSP nonce 放行：`.vscodeignore` 排除了
 *   `src/**`，走 media/ 目录反而要额外改打包配置，内联最省事。
 * - 面板只负责「展示 + 收集输入 + 回传」，写盘与校验由 extension.ts 的
 *   applyPanelSave 用 src/config/prefsPatch.ts 的纯函数完成（与单应用编辑同一套语义）。
 * - 单例：重复打开只 reveal 已有面板，避免出现两份互相覆盖的编辑器。
 */
import * as vscode from 'vscode';
import type { AppPreference, AppState } from '../model/types';
import type { RawRowInput } from '../config/prefsPatch';
import { t } from '../i18n';

/** 表格的一行 = 一个可启动应用 */
export interface PanelRow {
  /** 应用 id（artifact id） */
  id: string;
  /** 模块相对路径 */
  relDir: string;
  /** 记住的 profile 覆盖；空串表示跟随 application.yml 默认 */
  profile: string;
  /** 可选 profile（下拉选项） */
  availableProfiles: string[];
  /** profile 留空时生效的默认 profile */
  defaultProfile: string;
  /** profile（含空串 key = 默认 profile）-> 配置文件里的端口 */
  profilePorts: Record<string, number>;
  /** 已记住的端口覆盖；undefined 表示跟随配置文件 */
  portOverride?: number;
  /** 当前生效端口 */
  port: number;
  /** 记住的主类覆盖；空串表示跟随扫描值 */
  mainClass: string;
  /** 扫描到的启动类 */
  scannedMainClass: string;
  /** 同模块的主类候选（可点标签） */
  mainClassCandidates: string[];
  /** 三态覆盖：undefined 表示跟随全局设置 */
  buildDependencies?: boolean;
  coverage?: boolean;
  state: AppState;
  /** 端口冲突提示（已按当前语言格式化） */
  conflict?: string;
  /** 落盘偏好快照：保存时用它做「已被外部修改」比对 */
  raw: AppPreference;
}

export interface PanelGroup {
  name: string;
  rows: PanelRow[];
}

export interface PanelModel {
  /** 真实分组（按 .vscode/web-boot.json 里的顺序） */
  groups: PanelGroup[];
  /** 未归组的应用 */
  ungroupedRows: PanelRow[];
  /** 「未分组」区标题（已本地化） */
  ungroupedLabel: string;
  /** 界面文案（key -> 当前语言文本） */
  labels: Record<string, string>;
  globalBuildDependencies: boolean;
  globalCoverage: boolean;
  /** 从分组右键打开时，用于高亮定位的分组名 */
  focusGroup?: string;
}

/** 保存时被跳过的行 */
export interface PanelSaveSkip {
  id: string;
  /** 已本地化的原因 */
  reason: string;
}

export interface PanelSaveResult {
  /** 实际写入的应用数 */
  saved: number;
  skipped: PanelSaveSkip[];
  /** 需要重启才生效的应用数（保存时正在运行） */
  needsRestart: number;
}

export interface PrefsPanelOptions {
  /** 面板标题（页签文字） */
  title: string;
  /** 构造当前数据 */
  buildModel: () => PanelModel;
  /** 保存：rawRows 是面板上每一行的原始输入，baseline 是面板展示时的落盘快照 */
  save: (
    rawRows: Record<string, RawRowInput>,
    baseline: Record<string, AppPreference>
  ) => Promise<PanelSaveResult>;
  /** 面板关闭时回调（用于清掉扩展侧的引用） */
  onDidDispose?: () => void;
}

/** 面板用到的文案 key（zh-cn 是 key 的唯一来源，en/ja 必须齐全） */
const LABEL_KEYS = [
  'panel.title',
  'panel.globals',
  'panel.btnSave',
  'panel.btnRevert',
  'panel.btnReload',
  'panel.statusClean',
  'panel.statusDirty',
  'panel.statusSaving',
  'panel.staleBanner',
  'panel.colApp',
  'panel.colProfile',
  'panel.colPort',
  'panel.colMainClass',
  'panel.colBuildDeps',
  'panel.colCoverage',
  'panel.colState',
  'panel.profileDefault',
  'panel.portHint',
  'panel.mainClassHint',
  'panel.followGlobalWith',
  'panel.empty',
  'panel.invalidPort',
  'panel.invalidMainClass',
  'panel.saveNothing',
  'panel.saveOk',
  'panel.saveSkipped',
  'panel.saveRestart',
  'panel.saveError',
  'panel.skipModified',
  'panel.skipUnknown',
  'panel.conflict'
] as const;

/** 收集面板文案：webview 里不能直接 import i18n，这里一次性把用到的 key 打包成表 */
export function buildPanelLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const key of LABEL_KEYS) {
    labels[key] = t(key);
  }
  labels['state.stopped'] = t('state.stopped');
  labels['state.starting'] = t('state.starting');
  labels['state.running'] = t('state.running');
  labels['state.stopping'] = t('state.stopping');
  labels['common.enabled'] = t('common.enabled');
  labels['common.disabled'] = t('common.disabled');
  labels['group.appCount'] = t('group.appCount');
  return labels;
}

/** 从 model 里取出「展示时的落盘快照」，供保存时比对 */
function baselineOf(model: PanelModel): Record<string, AppPreference> {
  const baseline: Record<string, AppPreference> = {};
  const rows = model.groups.flatMap((g) => g.rows).concat(model.ungroupedRows);
  for (const row of rows) {
    baseline[row.id] = { ...row.raw };
  }
  return baseline;
}

export class PrefsPanel implements vscode.Disposable {
  private static instance: PrefsPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  /** 面板当前展示数据对应的落盘快照 */
  private baseline: Record<string, AppPreference> = {};
  /** 面板上是否有未保存的修改（webview 主动上报） */
  private dirty = false;
  private disposed = false;

  /** 打开（或聚焦已有）参数面板 */
  static show(options: PrefsPanelOptions): PrefsPanel {
    if (PrefsPanel.instance && !PrefsPanel.instance.disposed) {
      PrefsPanel.instance.panel.reveal(vscode.ViewColumn.Active);
      PrefsPanel.instance.pushModel();
      return PrefsPanel.instance;
    }
    const model = options.buildModel();
    const panel = vscode.window.createWebviewPanel(
      'webBoot.prefsPanel',
      options.title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: []
      }
    );
    PrefsPanel.instance = new PrefsPanel(panel, model, options);
    return PrefsPanel.instance;
  }

  /** 是否有实例（extension.ts 用来决定要不要推送数据） */
  static get current(): PrefsPanel | undefined {
    return PrefsPanel.instance && !PrefsPanel.instance.disposed
      ? PrefsPanel.instance
      : undefined;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    initialModel: PanelModel,
    private readonly options: PrefsPanelOptions
  ) {
    this.baseline = baselineOf(initialModel);
    this.panel.webview.html = renderHtml();
    this.disposables.push(
      this.panel.onDidDispose(() => this.handleDispose()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message);
      })
    );
  }

  /**
   * 外部数据变化（重新扫描 / 改了配置）。
   * 面板有未保存修改时只提示「已变化」，绝不覆盖用户输入。
   */
  refresh(): void {
    if (this.disposed) {
      return;
    }
    this.pushModel();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (PrefsPanel.instance === this) {
      PrefsPanel.instance = undefined;
    }
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
    this.panel.dispose();
  }

  private handleDispose(): void {
    this.disposed = true;
    if (PrefsPanel.instance === this) {
      PrefsPanel.instance = undefined;
    }
    this.options.onDidDispose?.();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') {
      return;
    }
    const type = (message as { type?: unknown }).type;
    if (type === 'ready' || type === 'reload') {
      this.pushModel();
      return;
    }
    if (type === 'dirty') {
      this.dirty = (message as { dirty?: unknown }).dirty === true;
      return;
    }
    if (type === 'save') {
      const rows = (message as { rows?: unknown }).rows;
      if (!rows || typeof rows !== 'object') {
        return;
      }
      try {
        const result = await this.options.save(
          rows as Record<string, RawRowInput>,
          this.baseline
        );
        this.dirty = false;
        // 先推新数据（清掉面板的编辑态），再回保存结果，保证摘要不被覆盖
        this.pushModel();
        void this.panel.webview.postMessage({ type: 'saved', result });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        void this.panel.webview.postMessage({
          type: 'error',
          message: t('panel.saveError', detail)
        });
      }
    }
  }

  /**
   * 把最新数据推给 webview。
   * 面板是脏的时不更新基线：这样保存时能发现「打开面板后该应用被别处改过」。
   */
  private pushModel(): void {
    if (this.disposed) {
      return;
    }
    let model: PanelModel;
    try {
      model = this.options.buildModel();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      void this.panel.webview.postMessage({ type: 'error', message: detail });
      return;
    }
    if (!this.dirty) {
      this.baseline = baselineOf(model);
    }
    void this.panel.webview.postMessage({ type: 'model', model, stale: this.dirty });
  }
}

/** 生成 webview 的 HTML（样式与脚本都内联，nonce 需要每次新建）；导出供自检脚本做语法/结构校验 */
export function renderHtml(): string {
  const nonce = Array.from({ length: 32 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36))
  ).join('');
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Web Boot</title>
<style nonce="${nonce}">
  body {
    margin: 0;
    padding: 12px 16px 32px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));
    position: sticky;
    top: 0;
    background: var(--vscode-editor-background);
    z-index: 2;
    flex-wrap: wrap;
  }
  .toolbar h1 {
    font-size: 1.05em;
    font-weight: 600;
    margin: 0 8px 0 0;
  }
  .toolbar .spacer { flex: 1; }
  button {
    font-family: inherit;
    font-size: inherit;
    padding: 3px 10px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.2));
    color: var(--vscode-button-secondaryForeground, inherit);
    cursor: pointer;
  }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button:hover { filter: brightness(1.12); }
  button:disabled { opacity: .5; cursor: default; }
  .status { font-size: .92em; opacity: .85; }
  .status.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
  .status.warn { color: var(--vscode-editorWarning-foreground, #d19a66); }
  .status.error { color: var(--vscode-errorForeground, #f85149); }
  .hidden { display: none !important; }
  .banner {
    margin: 10px 0 0;
    padding: 6px 10px;
    border-left: 3px solid var(--vscode-editorWarning-foreground, #d19a66);
    background: var(--vscode-editorWarning-background, rgba(209,154,102,.14));
    font-size: .95em;
  }
  section { margin-top: 18px; }
  section.focus h2 { color: var(--vscode-focusBorder, #4daafc); }
  h2 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: .98em;
    font-weight: 600;
    margin: 0 0 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));
  }
  h2 .muted { font-weight: 400; font-size: .9em; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th, td {
    text-align: left;
    padding: 5px 8px 5px 0;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.22));
    vertical-align: top;
  }
  th { font-weight: 600; opacity: .8; font-size: .92em; white-space: nowrap; }
  th:last-child, td:last-child { padding-right: 0; }
  td.app .id { font-weight: 600; }
  td.app .dir, .muted { opacity: .68; }
  .mono { font-family: var(--vscode-editor-font-family, monospace); font-size: .92em; }
  input, select {
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    font-size: inherit;
    padding: 2px 4px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,.4));
    border-radius: 2px;
  }
  input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder, #4daafc); }
  tr.dirty td.app { box-shadow: inset 3px 0 0 var(--vscode-editorWarning-foreground, #d19a66); }
  tr.dirty td.app .id::after { content: ' *'; color: var(--vscode-editorWarning-foreground, #d19a66); }
  tr.invalid td.app { box-shadow: inset 3px 0 0 var(--vscode-errorForeground, #f85149); }
  tr.invalid td.app .id::after { content: ' !'; color: var(--vscode-errorForeground, #f85149); }
  .hint { font-size: .85em; opacity: .65; margin-top: 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
  .chip {
    font-family: inherit;
    font-size: .85em;
    line-height: 1.5;
    padding: 0 6px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.4));
    background: transparent;
    color: inherit;
    opacity: .8;
    cursor: pointer;
    border-radius: 2px;
  }
  .chip:hover { opacity: 1; border-color: var(--vscode-focusBorder, #4daafc); }
  .chip.active { opacity: 1; border-color: var(--vscode-focusBorder, #4daafc); color: var(--vscode-focusBorder, #4daafc); }
  .conflict { color: var(--vscode-editorWarning-foreground, #d19a66); font-size: .9em; margin-top: 2px; }
  .empty { opacity: .8; }
</style>
</head>
<body>
<div class="toolbar">
  <h1 id="title"></h1>
  <span class="muted" id="globals"></span>
  <span class="spacer"></span>
  <span id="status" class="status"></span>
  <button id="btn-save" class="primary"></button>
  <button id="btn-revert"></button>
  <button id="btn-reload"></button>
</div>
<div id="banner" class="banner hidden"></div>
<div id="content"></div>
<script nonce="${nonce}">${CLIENT_JS}</script>
</body>
</html>`;
}

/**
 * webview 里的脚本。
 *
 * 注意：这里是字符串，不是 TS 代码；刻意不用模板字符串 / 正则，避免转义踩坑。
 * 数据流向：ready -> model -> 用户编辑（只存改动到 EDITS）-> save -> saved + 新 model。
 */
const CLIENT_JS = `
(function () {
  var vscode = acquireVsCodeApi();
  var MODEL = null;
  // appId -> { profile, port, mainClass, buildDependencies, coverage }（都是字符串，'' = 跟随）
  var EDITS = {};
  // 最近一次保存时因本地校验被拦下的行（保存后并入状态提示）
  var LOCAL_INVALID = [];
  // 正在编辑时收到的模型推送：推迟到失焦后再重绘，避免打断打字
  var PENDING = null;
  var DIRTY = false;
  var SAVING = false;
  var STATUS = null;

  function T(key) {
    if (MODEL && MODEL.labels && Object.prototype.hasOwnProperty.call(MODEL.labels, key)) {
      return MODEL.labels[key];
    }
    return key;
  }

  function fmt(key) {
    var text = T(key);
    for (var i = 1; i < arguments.length; i++) {
      text = text.split('{' + (i - 1) + '}').join(String(arguments[i]));
    }
    return text;
  }

  function esc(value) {
    var text = value === undefined || value === null ? '' : String(value);
    return text
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function allRows() {
    if (!MODEL) return [];
    var rows = [];
    MODEL.groups.forEach(function (group) {
      group.rows.forEach(function (row) { rows.push(row); });
    });
    MODEL.ungroupedRows.forEach(function (row) { rows.push(row); });
    return rows;
  }

  function rowById(id) {
    var rows = allRows();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) return rows[i];
    }
    return null;
  }

  function configPortFor(row, profile) {
    if (row.profilePorts && Object.prototype.hasOwnProperty.call(row.profilePorts, profile)) {
      return row.profilePorts[profile];
    }
    return row.port;
  }

  function editOf(row) {
    if (!EDITS[row.id]) {
      EDITS[row.id] = {
        profile: row.profile || '',
        port: row.portOverride === undefined ? '' : String(row.portOverride),
        mainClass: row.mainClass || '',
        buildDependencies: row.buildDependencies === undefined ? '' : String(row.buildDependencies),
        coverage: row.coverage === undefined ? '' : String(row.coverage)
      };
    }
    return EDITS[row.id];
  }

  // ---------------- 渲染 ----------------
  function headerCells() {
    var keys = ['panel.colApp', 'panel.colProfile', 'panel.colPort', 'panel.colMainClass',
      'panel.colBuildDeps', 'panel.colCoverage', 'panel.colState'];
    var html = '';
    keys.forEach(function (key) { html += '<th>' + esc(T(key)) + '</th>'; });
    return '<thead><tr>' + html + '</tr></thead>';
  }

  function rowHtml(row) {
    var edit = editOf(row);
    var profile = edit.profile;
    var configPort = configPortFor(row, profile);
    var stateKey = 'state.' + row.state;

    // profile 建议：输入框是纯文本（可任意输入，不带 datalist —— datalist 会把输入框
    // 变成 combobox，webview 里既挡打字又容易被重绘打断），已知 profile 用可点标签给出
    var profileHint = fmt('panel.profileDefault', row.defaultProfile || '');
    var pfChips = '';
    row.availableProfiles.forEach(function (name) {
      pfChips += '<button type="button" class="chip' + (profile === name ? ' active' : '') +
        '" data-id="' + esc(row.id) + '" data-chip-field="profile" data-chip-value="' +
        esc(name) + '">' +
        esc(name) + '</button>';
    });

    // 主类候选同样用可点标签（不带 datalist，理由同 profile：不要 combobox）
    var mcChips = '';
    (row.mainClassCandidates || []).forEach(function (name) {
      mcChips += '<button type="button" class="chip' +
        (edit.mainClass === name ? ' active' : '') +
        '" data-id="' + esc(row.id) + '" data-chip-field="mainClass" data-chip-value="' +
        esc(name) + '">' +
        esc(name) + '</button>';
    });

    var follow = fmt('panel.followGlobalWith', T('common.' + (MODEL.globalBuildDependencies ? 'enabled' : 'disabled')));
    var amOptions = '<option value="">' + esc(follow) + '</option>' +
      '<option value="true">' + esc(T('common.enabled')) + '</option>' +
      '<option value="false">' + esc(T('common.disabled')) + '</option>';
    var covFollow = fmt('panel.followGlobalWith', T('common.' + (MODEL.globalCoverage ? 'enabled' : 'disabled')));
    var covOptions = '<option value="">' + esc(covFollow) + '</option>' +
      '<option value="true">' + esc(T('common.enabled')) + '</option>' +
      '<option value="false">' + esc(T('common.disabled')) + '</option>';

    var stateText = T(stateKey);
    var conflict = row.conflict
      ? '<div class="conflict">' + esc(row.conflict) + '</div>'
      : '';

    var html = '';
    html += '<tr data-row="' + esc(row.id) + '">';
    html += '<td class="app"><div class="id">' + esc(row.id) + '</div>' +
      '<div class="dir mono">' + esc(row.relDir) + '</div></td>';
    html += '<td><input type="text" data-id="' + esc(row.id) + '" data-field="profile" ' +
      'value="' + esc(edit.profile) + '" ' +
      'placeholder="' + esc(profileHint) + '" title="' + esc(profileHint) + '" />' +
      (pfChips ? '<div class="chips">' + pfChips + '</div>' : '') +
      '<div class="hint">' + esc(profileHint) + '</div></td>';
    html += '<td><input type="text" inputmode="numeric" data-id="' + esc(row.id) + '" data-field="port" ' +
      'data-role="port" value="' + esc(edit.port) + '" />' +
      '<div class="hint" data-role="port-hint" data-id="' + esc(row.id) + '">' +
      esc(fmt('panel.portHint', configPort)) + '</div></td>';
    html += '<td><input type="text" data-id="' + esc(row.id) + '" data-field="mainClass" ' +
      'value="' + esc(edit.mainClass) + '" placeholder="' + esc(row.scannedMainClass) + '" ' +
      'title="' + esc(fmt('panel.mainClassHint', row.scannedMainClass)) + '" />' +
      (mcChips ? '<div class="chips">' + mcChips + '</div>' : '') + '</td>';
    html += '<td><select data-id="' + esc(row.id) + '" data-field="buildDependencies">' + amOptions + '</select></td>';
    html += '<td><select data-id="' + esc(row.id) + '" data-field="coverage">' + covOptions + '</select></td>';
    html += '<td><div>' + esc(stateText) + '</div>' + conflict + '</td>';
    html += '</tr>';
    return html;
  }

  function sectionHtml(title, rows, key, withTitle) {
    var html = '<section data-section="' + esc(key) + '">';
    if (withTitle) {
      html += '<h2>' + esc(title) + '<span class="muted">' + esc(fmt('group.appCount', rows.length)) + '</span></h2>';
    }
    html += '<table>' + headerCells() + '<tbody>';
    rows.forEach(function (row) { html += rowHtml(row); });
    html += '</tbody></table></section>';
    return html;
  }

  function render() {
    var content = byId('content');
    if (!MODEL) {
      content.innerHTML = '';
      return;
    }
    var rows = allRows();
    if (rows.length === 0) {
      content.innerHTML = '<p class="empty">' + esc(T('panel.empty')) + '</p>';
      return;
    }
    var html = '';
    MODEL.groups.forEach(function (group, index) {
      html += sectionHtml(group.name, group.rows, 'group-' + index, true);
    });
    if (MODEL.ungroupedRows.length > 0) {
      html += sectionHtml(MODEL.ungroupedLabel, MODEL.ungroupedRows, 'ungrouped', MODEL.groups.length > 0);
    }
    content.innerHTML = html;

    var fields = content.querySelectorAll('[data-field]');
    for (var i = 0; i < fields.length; i++) {
      fields[i].addEventListener('input', onFieldChange);
      fields[i].addEventListener('change', onFieldChange);
      syncField(fields[i]);
    }
    var chips = content.querySelectorAll('[data-chip-field]');
    for (var c = 0; c < chips.length; c++) {
      chips[c].addEventListener('click', onChipClick);
    }
    syncGlobals();
    highlightFocus();
  }

  /** 点建议标签：把值填进同一行的输入框（等同手输一次，走同一条 dirty 流程） */
  function onChipClick(ev) {
    var el = ev.currentTarget;
    var id = el.getAttribute('data-id');
    var field = el.getAttribute('data-chip-field');
    var value = el.getAttribute('data-chip-value');
    if (!id || !field || value === null) return;
    var input = document.querySelector('[data-field="' + field + '"][data-id="' + id + '"]');
    if (!input) return;
    input.value = value;
    input.focus();
    onFieldChange({ target: input });
  }

  /** 把 EDITS 里的值写回控件（innerHTML 之后 value 需要重新设置） */
  function syncField(el) {
    var id = el.getAttribute('data-id');
    var field = el.getAttribute('data-field');
    var edit = EDITS[id];
    if (!edit) return;
    if (el.value !== edit[field]) {
      el.value = edit[field];
    }
  }

  function syncGlobals() {
    if (!MODEL) return;
    byId('title').textContent = T('panel.title');
    byId('globals').textContent = fmt(
      'panel.globals',
      T('common.' + (MODEL.globalBuildDependencies ? 'enabled' : 'disabled')),
      T('common.' + (MODEL.globalCoverage ? 'enabled' : 'disabled'))
    );
    byId('btn-save').textContent = T('panel.btnSave');
    byId('btn-revert').textContent = T('panel.btnRevert');
    byId('btn-reload').textContent = T('panel.btnReload');
  }

  function highlightFocus() {
    if (!MODEL || !MODEL.focusGroup) return;
    var sections = document.querySelectorAll('[data-section]');
    for (var i = 0; i < sections.length; i++) {
      var head = sections[i].querySelector('h2');
      if (head && head.textContent.indexOf(MODEL.focusGroup) === 0) {
        sections[i].className = 'focus';
        if (sections[i].scrollIntoView) {
          sections[i].scrollIntoView({ block: 'nearest' });
        }
        return;
      }
    }
  }

  // ---------------- 状态 / 横幅 ----------------
  function updateStatus() {
    var el = byId('status');
    if (!el) return;
    if (STATUS) {
      el.textContent = STATUS.text;
      el.className = 'status ' + STATUS.kind;
      return;
    }
    if (SAVING) {
      el.textContent = T('panel.statusSaving');
      el.className = 'status';
      return;
    }
    el.textContent = DIRTY ? T('panel.statusDirty') : T('panel.statusClean');
    el.className = DIRTY ? 'status warn' : 'status';
  }

  function setStatus(text, kind) {
    STATUS = { text: text, kind: kind || '' };
    updateStatus();
  }

  function showBanner(text) {
    var el = byId('banner');
    el.textContent = text;
    el.className = 'banner';
  }

  function hideBanner() {
    var el = byId('banner');
    el.textContent = '';
    el.className = 'banner hidden';
  }

  function markDirty(id, dirty) {
    var tr = document.querySelector('[data-row="' + id + '"]');
    if (!tr) return;
    tr.className = dirty ? 'dirty' : '';
  }

  function markAllClean() {
    var rows = document.querySelectorAll('[data-row]');
    for (var i = 0; i < rows.length; i++) {
      rows[i].className = '';
    }
  }

  // ---------------- 交互 ----------------
  function onFieldChange(ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) return;
    var id = el.getAttribute('data-id');
    var field = el.getAttribute('data-field');
    if (!id || !field) return;
    var row = rowById(id);
    if (!row) return;
    var edit = editOf(row);
    edit[field] = el.value;
    STATUS = null;

    if (field === 'profile') {
      // 换 profile 不再联动清端口（面板语义 = 输入什么存什么，端口只由用户输入决定）；
      // 这里只更新提示：新 profile 在配置文件里的端口是多少
      var hint = document.querySelector('[data-role="port-hint"][data-id="' + id + '"]');
      if (hint) {
        hint.textContent = fmt('panel.portHint', configPortFor(row, edit.profile));
      }
    }

    DIRTY = true;
    markDirty(id, true);
    updateStatus();
    vscode.postMessage({ type: 'dirty', dirty: true });
  }

  // 与单应用编辑的 validateInput 完全一致：留空 = 跟随配置文件端口；
  // 其余按 Number 解析，必须是 1 - 65535 的整数（" 8080 "、"+8080"、"8080.0" 都合法）
  function isPortText(text) {
    var trimmed = String(text).trim();
    if (trimmed === '') return true;
    var num = Number(trimmed);
    return Number.isInteger(num) && num > 0 && num <= 65535;
  }

  function isFqn(text) {
    if (!text) return false;
    var parts = text.split('.');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part) return false;
      var first = part.charAt(0);
      if (!(first === '_' || first === '$' ||
        (first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z'))) {
        return false;
      }
      for (var j = 1; j < part.length; j++) {
        var c = part.charAt(j);
        if (!(c === '_' || c === '$' ||
          (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9'))) {
          return false;
        }
      }
    }
    return true;
  }

  function markInvalid(id, invalid) {
    var tr = document.querySelector('[data-row="' + id + '"]');
    if (!tr) return;
    if (invalid) {
      tr.className = 'invalid';
    } else if (tr.className === 'invalid') {
      tr.className = '';
    }
  }

  function validateRow(row, edit) {
    if (!isPortText(edit.port || '')) {
      return fmt('panel.invalidPort', row.id);
    }
    var mainClass = (edit.mainClass || '').trim();
    if (mainClass && !isFqn(mainClass)) {
      return fmt('panel.invalidMainClass', row.id);
    }
    return null;
  }

  function localInvalidText(list) {
    var reasons = [];
    for (var i = 0; i < list.length; i++) {
      reasons.push(list[i].reason);
    }
    return fmt('panel.saveSkipped', 0, list.length, reasons.join('; '));
  }

  function onSave() {
    if (!MODEL || SAVING) return;
    var rows = {};
    var invalid = [];
    var savedCount = 0;
    var all = allRows();
    for (var i = 0; i < all.length; i++) {
      var row = all[i];
      var edit = editOf(row);
      var error = validateRow(row, edit);
      if (error) {
        // 非法行不发给扩展：标红该行，其余行照常保存（与单应用编辑一样只影响这一格）
        invalid.push({ id: row.id, reason: error });
        markInvalid(row.id, true);
        continue;
      }
      markInvalid(row.id, false);
      var out = { profile: edit.profile };
      if (edit.port !== '') out.port = edit.port;
      if (edit.mainClass !== '') out.mainClass = edit.mainClass.trim();
      if (edit.buildDependencies !== '') out.buildDependencies = edit.buildDependencies === 'true';
      if (edit.coverage !== '') out.coverage = edit.coverage === 'true';
      rows[row.id] = out;
      savedCount++;
    }
    LOCAL_INVALID = invalid;
    if (savedCount === 0) {
      // 没有可保存的行：不发请求，直接在状态栏说明哪几行没保存
      setStatus(localInvalidText(invalid), 'error');
      return;
    }
    SAVING = true;
    STATUS = null;
    updateStatus();
    vscode.postMessage({ type: 'save', rows: rows });
  }

  function onRevert() {
    EDITS = {};
    PENDING = null;
    DIRTY = false;
    STATUS = null;
    hideBanner();
    render();
    markAllClean();
    updateStatus();
    vscode.postMessage({ type: 'dirty', dirty: false });
  }

  function onSaved(result) {
    SAVING = false;
    DIRTY = false;
    var localInvalid = LOCAL_INVALID;
    var hadLocalInvalid = localInvalid.length > 0;
    var skipped = (result.skipped || []).concat(localInvalid);
    LOCAL_INVALID = [];
    var text;
    if (result.saved === 0 && skipped.length === 0) {
      text = T('panel.saveNothing');
    } else if (skipped.length === 0) {
      text = fmt('panel.saveOk', result.saved);
    } else {
      text = fmt(
        'panel.saveSkipped',
        result.saved,
        skipped.length,
        skipped.map(function (item) { return item.reason; }).join('; ')
      );
    }
    if (result.needsRestart > 0) {
      text += ' ' + fmt('panel.saveRestart', result.needsRestart);
    }
    setStatus(text, hadLocalInvalid ? 'error' : skipped.length > 0 ? 'warn' : 'ok');
    markAllClean();
    // 本地校验没过的行没保存，保持标红，等用户改掉
    for (var j = 0; j < localInvalid.length; j++) {
      markInvalid(localInvalid[j].id, true);
    }
  }

  /** 是否正在某个编辑控件里打字：此时重绘会打断输入（焦点、光标、输入法组字都会丢） */
  function isEditingField() {
    var el = document.activeElement;
    return !!(el && el.getAttribute && el.getAttribute('data-field'));
  }

  function applyModel(model, stale) {
    if (isEditingField()) {
      // 打字期间绝不重建 DOM：这次推送推迟到失焦后再应用（改动都在 EDITS 里，不会丢）
      PENDING = { model: model, stale: stale };
      return;
    }
    doApplyModel(model, stale);
  }

  /** 失焦后应用被推迟的模型推送 */
  function flushPending() {
    if (!PENDING) return;
    var pending = PENDING;
    PENDING = null;
    doApplyModel(pending.model, pending.stale);
  }

  function doApplyModel(model, stale) {
    PENDING = null;
    MODEL = model;
    if (!stale) {
      EDITS = {};
      LOCAL_INVALID = [];
      DIRTY = false;
      SAVING = false;
      STATUS = null;
    }
    render();
    if (stale) {
      showBanner(T('panel.staleBanner'));
    } else {
      hideBanner();
    }
    updateStatus();
  }

  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'model') {
      applyModel(msg.model, msg.stale === true);
    } else if (msg.type === 'saved') {
      onSaved(msg.result);
    } else if (msg.type === 'error') {
      SAVING = false;
      setStatus(msg.message, 'error');
    }
  });

  byId('btn-save').addEventListener('click', onSave);
  byId('btn-revert').addEventListener('click', onRevert);
  // 输入框失焦后才应用被推迟的模型推送（延一拍，保证 change 事件先把值写进 EDITS）
  byId('content').addEventListener('focusout', function () {
    setTimeout(flushPending, 0);
  });
  byId('btn-reload').addEventListener('click', function () {
    EDITS = {};
    PENDING = null;
    LOCAL_INVALID = [];
    DIRTY = false;
    STATUS = null;
    vscode.postMessage({ type: 'dirty', dirty: false });
    vscode.postMessage({ type: 'reload' });
  });

  vscode.postMessage({ type: 'ready' });
})();
`;
