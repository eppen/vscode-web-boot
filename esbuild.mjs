// esbuild 打包脚本：把 src/extension.ts 打成单文件 dist/extension.js
// 用法：node esbuild.mjs [--watch]
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  // vscode 由宿主提供，不能打进产物
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node16',
  sourcemap: true,
  minify: false,
  logLevel: 'info'
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[esbuild] watching...');
} else {
  await esbuild.build(options);
}
