/**
 * 参数面板相关的纯逻辑自检：
 * 1. PreferenceStore.applyMany 批量写入：一次落盘写多个应用、undefined 清字段、不动已有分组
 * 2. diffPreference 的写盘语义：端口/主类回退、换 profile 清端口、三态 -am/覆盖率、非法输入被拒
 * 仅用于验证，不参与扩展打包。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PreferenceStore } from '../src/config/store';
import { diffPreference, samePreference, type DiffInput } from '../src/config/prefsPatch';
import { buildPanelLabels, renderHtml } from '../src/views/prefsPanel';
import { zhCN } from '../src/i18n/locales/zh-cn';
import type { AppPreference } from '../src/model/types';

let failed = 0;

/** 按键名排序后再序列化，避免对象字面量的字段顺序影响比较结果 */
function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function check(name: string, actual: unknown, expected: unknown): void {
  const a = stable(actual);
  const e = stable(expected);
  if (a === e) {
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        期望: ${e}`);
    console.log(`        实际: ${a}`);
  }
}

function checkTrue(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

/** diffPreference 的默认入参，各用例只改关心的字段 */
function diffInput(over: Partial<DiffInput> = {}): DiffInput {
  return {
    scannedMainClass: 'com.example.DemoApplication',
    configPort: 8080,
    previousPort: 8080,
    availableProfiles: ['dev', 'test'],
    current: {},
    next: {},
    ...over
  };
}

function readConfig(store: PreferenceStore): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(store.filePath, 'utf8')) as Record<string, unknown>;
}

async function testApplyMany(root: string): Promise<void> {
  // 先造一点已有数据：一个应用记住端口，一个分组
  const store = new PreferenceStore(path.join(root, 'apply-many'));
  await store.set('mes-a', { profile: 'dev', port: 9090 });
  await store.createGroup('前端');
  await store.assignApps(['mes-a'], '前端');

  // 批量写入两个应用：mes-a 清掉端口并换主类，mes-b 全新
  await store.applyMany({
    'mes-a': { profile: 'dev', port: undefined, mainClass: 'com.example.Other' },
    'mes-b': { profile: 'test', buildDependencies: false, coverage: true }
  });

  const written = readConfig(store) as {
    apps: Record<string, AppPreference>;
    groups: Array<{ name: string; apps: string[] }>;
  };
  check(
    '一次 applyMany 写入了多个应用',
    Object.keys(written.apps).sort(),
    ['mes-a', 'mes-b']
  );
  check(
    'patch 里的 undefined 清掉了旧字段（JSON 里不再有 port）',
    'port' in written.apps['mes-a'],
    false
  );
  check('未提及的字段保留（profile）', written.apps['mes-a'].profile, 'dev');
  check('新应用的三态字段按输入写入', written.apps['mes-b'], {
    profile: 'test',
    buildDependencies: false,
    coverage: true
  });
  check('已有分组不被批量写入破坏', written.groups, [{ name: '前端', apps: ['mes-a'] }]);

  // 空 patch 不应该动文件
  const before = fs.readFileSync(store.filePath, 'utf8');
  await store.applyMany({});
  checkTrue('空 patch 不写盘', fs.readFileSync(store.filePath, 'utf8') === before);

  // 缓存与落盘一致：重新构造 store 读一遍
  const reread = new PreferenceStore(path.join(root, 'apply-many'));
  check('重新加载后 mes-a 的端口仍是未覆盖', reread.get('mes-a').port, undefined);
  check('重新加载后 mes-b 的覆盖率覆盖仍在', reread.get('mes-b').coverage, true);
  check('重新加载后分组仍是「前端」', reread.groupOf('mes-a'), '前端');
}

function testDiff(): void {
  // ---------- 端口 ----------
  const emptyPort = diffPreference(
    diffInput({ current: { port: 9090 }, next: { port: '' }, previousPort: 9090 })
  );
  check('端口留空 -> 清掉覆盖', emptyPort.patch.port, undefined);
  checkTrue('端口留空视为有变化', emptyPort.changed);

  check(
    '端口等于配置文件端口 -> 不写覆盖',
    diffPreference(diffInput({ next: { port: '8080' } })).patch.port,
    undefined
  );
  check(
    '端口与配置不同 -> 写覆盖',
    diffPreference(diffInput({ next: { port: ' 9091 ' } })).patch.port,
    9091
  );
  check(
    '端口超范围 -> 判为非法',
    diffPreference(diffInput({ next: { port: '70000' } })).invalid,
    'port'
  );
  check('端口非数字 -> 判为非法', diffPreference(diffInput({ next: { port: '80x' } })).invalid, 'port');

  // ---------- 换 profile 清端口 ----------
  const switchProfile = diffPreference(
    diffInput({
      current: { profile: 'dev', port: 9090 },
      next: { profile: 'test', port: '9090' },
      previousPort: 9090
    })
  );
  check('换 profile 时清掉旧端口覆盖', switchProfile.patch, {
    profile: 'test',
    port: undefined,
    mainClass: undefined,
    buildDependencies: undefined,
    coverage: undefined
  });

  const switchWithNewPort = diffPreference(
    diffInput({
      current: { profile: 'dev', port: 9090 },
      next: { profile: 'test', port: '7070' },
      previousPort: 9090
    })
  );
  check('换 profile 且显式改了端口 -> 保留新端口', switchWithNewPort.patch.port, 7070);

  const clearProfile = diffPreference(diffInput({ current: { profile: 'dev' }, next: {} }));
  check('profile 留空 -> 跟随 yml 默认', clearProfile.patch.profile, undefined);

  check(
    'profile 不在可用列表 -> 判为非法',
    diffPreference(diffInput({ next: { profile: 'uat' } })).invalid,
    'profile'
  );

  // ---------- 主类 ----------
  check(
    '主类留空 -> 不写覆盖',
    diffPreference(diffInput({ current: { mainClass: 'com.example.X' }, next: {} })).patch
      .mainClass,
    undefined
  );
  check(
    '主类等于扫描值 -> 不写覆盖',
    diffPreference(diffInput({ next: { mainClass: 'com.example.DemoApplication' } })).patch
      .mainClass,
    undefined
  );
  check(
    '主类不同 -> 写覆盖',
    diffPreference(diffInput({ next: { mainClass: 'com.example.Custom$Inner' } })).patch.mainClass,
    'com.example.Custom$Inner'
  );
  check(
    '主类非全限定名 -> 判为非法',
    diffPreference(diffInput({ next: { mainClass: 'Demo Application' } })).invalid,
    'mainClass'
  );

  // ---------- 三态 ----------
  check(
    '-am / 覆盖率不选 -> 跟随全局（字段为 undefined）',
    diffPreference(diffInput({ next: {} })).patch,
    {
      profile: undefined,
      port: undefined,
      mainClass: undefined,
      buildDependencies: undefined,
      coverage: undefined
    }
  );
  check('覆盖率关闭 -> 写 false', diffPreference(diffInput({ next: { coverage: false } })).patch.coverage, false);

  // ---------- changed ----------
  const unchanged = diffPreference(
    diffInput({
      current: { profile: 'dev', port: 9091, mainClass: 'com.example.X', coverage: true },
      next: { profile: 'dev', port: '9091', mainClass: 'com.example.X', coverage: true },
      previousPort: 9091
    })
  );
  checkTrue('与基线一致时 changed = false', !unchanged.changed);
  checkTrue('samePreference 对多余字段不敏感', samePreference({ profile: 'dev' }, { profile: 'dev' }));
  checkTrue(
    'samePreference 能识别差异',
    !samePreference({ profile: 'dev', port: 1 }, { profile: 'dev', port: 2 })
  );
}

function testPanelHtml(): void {
  const html = renderHtml();
  checkTrue('面板 HTML 是完整文档', html.startsWith('<!DOCTYPE html>'));
  checkTrue('面板 HTML 带 CSP（default-src none）', html.includes("default-src 'none'"));
  checkTrue(
    '面板 HTML 不引外部资源（只内联）',
    !html.includes('http://') && !html.includes('https://') && !html.includes('<link')
  );
  const nonce = /nonce-([a-z0-9]+)/.exec(html)?.[1] ?? '';
  checkTrue('CSP 带 nonce', nonce.length > 0);
  checkTrue(
    'style 与 script 标签都带同一个 nonce',
    !!nonce && html.split(`nonce="${nonce}"`).length === 3,
    `出现 ${html.split(`nonce="${nonce}"`).length - 1} 处`
  );

  // 内联脚本是字符串，tsc 不会检查它的语法，这里补一次
  const script = /<script nonce="[a-z0-9]+">([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
  let syntaxError: string | undefined;
  try {
    new Function(script);
  } catch (err) {
    syntaxError = err instanceof Error ? err.message : String(err);
  }
  check('内联脚本语法合法', syntaxError, undefined);
  checkTrue('内联脚本会向扩展请求数据（ready）', script.includes("type: 'ready'"));
  checkTrue('内联脚本处理保存结果（saved）', script.includes("'saved'"));

  const labels = buildPanelLabels();
  check(
    '面板文案没有空值',
    Object.entries(labels)
      .filter(([, value]) => !value.trim())
      .map(([key]) => key),
    []
  );
  check(
    '面板文案 key 都在词典里',
    Object.keys(labels).filter((key) => !(key in zhCN)),
    []
  );
  check('面板列头取自词典', labels['panel.colPort'], zhCN['panel.colPort']);
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-boot-prefs-'));
  try {
    console.log('--- PreferenceStore.applyMany ---');
    await testApplyMany(root);
    console.log('--- diffPreference ---');
    testDiff();
    console.log('--- 参数面板 HTML ---');
    testPanelHtml();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('');
  console.log(failed === 0 ? '全部通过' : `失败 ${failed} 项`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
