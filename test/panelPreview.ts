/**
 * 预览用：把参数面板的 HTML 落到 test/.tmp/panel.html（带上假数据与 acquireVsCodeApi 桩），
 * 方便用无头浏览器检查渲染结果。只用于本地验证，不参与打包。
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildPanelLabels, renderHtml, type PanelModel, type PanelRow } from '../src/views/prefsPanel';
import { initI18n } from '../src/i18n';

initI18n('zh-cn', 'auto');

function row(id: string, relDir: string, over: Partial<PanelRow> = {}): PanelRow {
  return {
    id,
    relDir,
    profile: '',
    availableProfiles: ['dev', 'test'],
    defaultProfile: 'dev',
    profilePorts: { '': 8080, dev: 8080, test: 8081 },
    portOverride: undefined,
    port: 8080,
    mainClass: '',
    scannedMainClass: 'com.example.Application',
    mainClassCandidates: ['com.example.Application'],
    buildDependencies: undefined,
    coverage: undefined,
    state: 'stopped',
    conflict: undefined,
    raw: {},
    ...over
  };
}

const model: PanelModel = {
  groups: [
    {
      name: '前端',
      rows: [
        row('mes-web', 'mes-web', {
          state: 'running',
          conflict: '端口 8080 冲突',
          portOverride: 8080,
          buildDependencies: true,
          coverage: true
        }),
        row('mes-portal', 'mes-portal', { profile: 'test', portOverride: 9090, port: 9090 })
      ]
    },
    { name: '服务', rows: [row('mes-api', 'mes-api')] }
  ],
  ungroupedRows: [row('mes-job', 'mes-job', { state: 'starting' })],
  ungroupedLabel: '未分组',
  labels: buildPanelLabels(),
  globalBuildDependencies: true,
  globalCoverage: false,
  focusGroup: '前端'
};

const stub = `<script>
window.__sent = [];
window.acquireVsCodeApi = function () {
  return {
    postMessage: function (msg) {
      window.__sent.push(msg);
      if (msg.type === 'ready' || msg.type === 'reload') {
        setTimeout(function () {
          window.postMessage({ type: 'model', model: ${JSON.stringify(model)}, stale: false }, '*');
        }, 5);
      }
      if (msg.type === 'save') {
        // 把面板发来的原始输入回显到标题旁，方便用快照核对消息协议
        var slot = document.getElementById('globals');
        if (slot) {
          slot.textContent = 'SAVE ' + JSON.stringify(msg.rows);
        }
        setTimeout(function () {
          window.postMessage({ type: 'saved', result: { saved: 2, skipped: [], needsRestart: 1 } }, '*');
        }, 5);
      }
    }
  };
};
</script>`;

let html = renderHtml();
// 预览时去掉 CSP（否则注入的桩脚本会被拦掉），生产环境仍然带 CSP
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
html = html.replace('<body>', `<body>\n${stub}`);

/**
 * 交互自测页：模拟「改端口 + 改覆盖率 -> 点保存」，把发出去的 save 消息与状态栏文案打到页面上，
 * 用无头浏览器快照就能确认消息协议与脏标记有没有走通。
 */
const harness = `<script>
window.addEventListener('message', function (ev) {
  var msg = ev.data;
  if (!msg || msg.type !== 'save') return;
  var pre = document.createElement('pre');
  pre.id = 'save-payload';
  pre.textContent = 'SAVE ' + JSON.stringify(msg.rows);
  document.body.appendChild(pre);
});
setTimeout(function () {
  var port = document.querySelector('[data-role="port"][data-id="mes-api"]');
  port.value = '7070';
  port.dispatchEvent(new Event('input', { bubbles: true }));
  var coverage = document.querySelector('select[data-field="coverage"][data-id="mes-api"]');
  coverage.value = 'true';
  coverage.dispatchEvent(new Event('change', { bubbles: true }));
  var before = document.getElementById('status').textContent;
  document.getElementById('btn-save').click();
  setTimeout(function () {
    var pre = document.createElement('pre');
    pre.id = 'harness';
    pre.textContent = 'DIRTY_BEFORE=' + before + ' | AFTER=' +
      document.getElementById('status').textContent;
    document.body.appendChild(pre);
    document.title = pre.textContent + ' || ' +
      document.getElementById('save-payload').textContent;
  }, 200);
}, 150);
</script>`;

const dir = path.join(process.cwd(), 'test', '.tmp');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'panel.html');
fs.writeFileSync(out, html, 'utf8');
const outTest = path.join(dir, 'panel-test.html');
fs.writeFileSync(outTest, html.replace('</body>', `${harness}\n</body>`), 'utf8');
console.log(`written ${out}`);
console.log(`written ${outTest}`);
