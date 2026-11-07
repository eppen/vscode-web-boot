/**
 * 多语言自检：
 * 1. 三份语言包的 key 集合完全一致（tsc 已保证，这里再按运行时校验一次）
 * 2. 同一 key 的占位符（{0} {1} …）在三种语言里一致，避免翻译时漏掉参数
 * 3. resolveLocale 的取值规则：显式偏好 > VS Code 显示语言 > 英文
 * 4. package.json 里的 %key% 在 package.nls*.json 中都存在，且各 nls 文件 key 集合一致
 * 仅用于验证，不参与扩展打包。
 */
import * as fs from 'fs';
import * as path from 'path';
import { formatMessage, initI18n, normalizeLocale, resolveLocale, t } from '../src/i18n';
import { zhCN } from '../src/i18n/locales/zh-cn';
import { en } from '../src/i18n/locales/en';
import { ja } from '../src/i18n/locales/ja';

let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
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

// ---------- key 集合一致性 ----------
const zhKeys = Object.keys(zhCN).sort();
const enKeys = Object.keys(en).sort();
const jaKeys = Object.keys(ja).sort();
check('en 的 key 与 zh-cn 一致', enKeys, zhKeys);
check('ja 的 key 与 zh-cn 一致', jaKeys, zhKeys);

// ---------- 占位符一致性 ----------
const placeholderRe = /\{(\d+)\}/g;
function placeholders(text: string): string {
  return Array.from(new Set(Array.from(text.matchAll(placeholderRe), (m) => m[1])))
    .sort()
    .join(',');
}

const bundleMismatch: string[] = [];
for (const key of zhKeys as Array<keyof typeof zhCN>) {
  const expected = placeholders(zhCN[key]);
  if (placeholders(en[key]) !== expected || placeholders(ja[key]) !== expected) {
    bundleMismatch.push(
      `${key}: zh=[${expected}] en=[${placeholders(en[key])}] ja=[${placeholders(ja[key])}]`
    );
  }
}
check('同一 key 在三种语言里的占位符一致', bundleMismatch, []);

// 没有空文案（漏翻译会留下空字符串）
const emptyKeys = zhKeys.filter(
  (key) =>
    zhCN[key as keyof typeof zhCN].trim() === '' ||
    en[key as keyof typeof en].trim() === '' ||
    ja[key as keyof typeof ja].trim() === ''
);
check('没有空文案', emptyKeys, []);

// ---------- formatMessage ----------
check('无参数时原样返回', formatMessage('abc {0}', []), 'abc {0}');
check('按位置替换', formatMessage('a={0} b={1}', ['X', 2]), 'a=X b=2');
check('缺少参数时保留占位符', formatMessage('{0}-{1}', ['X']), 'X-{1}');
check('数字参数转字符串', formatMessage('{0} 个', [3]), '3 个');
check('占位符可重复使用', formatMessage('{0}/{0}', [7]), '7/7');

// ---------- normalizeLocale ----------
check('auto 归一化为 undefined', normalizeLocale('auto'), undefined);
check('空值归一化为 undefined', normalizeLocale(''), undefined);
check('zh-CN -> zh-cn', normalizeLocale('zh-CN'), 'zh-cn');
check('zh-tw 归入 zh-cn', normalizeLocale('zh-tw'), 'zh-cn');
check('ja -> ja', normalizeLocale('ja'), 'ja');
check('en-GB -> en', normalizeLocale('en-GB'), 'en');
check('未支持语言归一化为 undefined', normalizeLocale('de'), undefined);

// ---------- resolveLocale ----------
check('显式偏好优先于显示语言', resolveLocale('zh-cn', 'ja'), 'ja');
check('auto 时跟随显示语言', resolveLocale('ja', 'auto'), 'ja');
check('显示语言 zh-cn -> zh-cn', resolveLocale('zh-cn', undefined), 'zh-cn');
check('未支持显示语言回落英文', resolveLocale('de', 'auto'), 'en');
check('都没设置时回落英文', resolveLocale(undefined, undefined), 'en');

// ---------- t() 随 initI18n 切换 ----------
initI18n('zh-cn', 'auto');
check('中文：state.running', t('state.running'), '运行中');
initI18n('en', 'auto');
check('英文：state.running', t('state.running'), 'Running');
initI18n('ja', 'auto');
check('日文：state.running', t('state.running'), '実行中');
check('日文带参数：msg.busy', t('msg.busy', 'mes-web'), 'mes-web は実行中または起動中です。先に停止してください。');

// ---------- package.nls 一致性 ----------
// esbuild 产物在 test/.tmp/ 下，__dirname 指向它；npm script 的 cwd 才是扩展根目录
const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as unknown;
const pkgText = JSON.stringify(pkg);
const usedKeys = Array.from(
  new Set(Array.from(pkgText.matchAll(/"%([^"%]+)%"/g), (m) => m[1]))
).sort();
checkTrue('package.json 使用了 %key% 占位', usedKeys.length > 0, `找到 ${usedKeys.length} 个`);

const nlsFiles = ['package.nls.json', 'package.nls.zh-cn.json', 'package.nls.ja.json'];
const bundles = nlsFiles.map((file) => {
  const full = path.join(root, file);
  const text = fs.readFileSync(full, 'utf8');
  return { file, data: JSON.parse(text) as Record<string, string> };
});

const baseKeys = Object.keys(bundles[0].data).sort();
for (const bundle of bundles.slice(1)) {
  check(`${bundle.file} 的 key 与 package.nls.json 一致`, Object.keys(bundle.data).sort(), baseKeys);
}

const missingInNls = usedKeys.filter((key) => !(key in bundles[0].data));
check('package.json 引用的 key 在 nls 中都存在', missingInNls, []);

const unusedNlsKeys = baseKeys.filter((key) => !usedKeys.includes(key));
check('nls 中没有未被引用的 key', unusedNlsKeys, []);

const emptyNls = bundles.flatMap((bundle) =>
  Object.entries(bundle.data)
    .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
    .map(([key]) => `${bundle.file}:${key}`)
);
check('nls 中没有空文案', emptyNls, []);

console.log('');
console.log(failed === 0 ? '全部通过' : `失败 ${failed} 项`);
process.exitCode = failed === 0 ? 0 : 1;
