/**
 * 扫描自检：在仓库根目录执行，打印 reactor / 应用 / 端口冲突统计。
 * 仅用于验证，不参与扩展打包。
 */
import { scanReactor } from '../src/scanner/maven';
import { scanBootApps } from '../src/scanner/bootApps';
import { defaultProfile, resolveContextPath, resolvePort } from '../src/scanner/springConfig';
import { computeConflicts } from '../src/util/ports';
import { findRepoRoot } from './root';
import { setScanRoot } from './vscode-stub';

async function main(): Promise<void> {
  const root = findRepoRoot(__dirname);
  setScanRoot(root);
  const reactor = scanReactor(root);
  const apps = await scanBootApps(root, reactor);

  console.log(`reactor 模块数: ${reactor.size}`);
  console.log(`可启动应用数: ${apps.length}`);
  console.log('');

  const targets = apps.map((app) => {
    const profile = defaultProfile(app.config);
    return {
      appId: app.id,
      profile,
      port: resolvePort(app.config, profile),
      contextPath: resolveContextPath(app.config, profile),
      inReactor: app.inReactor,
      note: app.reactorNote,
      profiles: app.config.profiles.filter((p) => p)
    };
  });

  for (const t of targets) {
    const flag = t.inReactor ? '' : '  [不在 reactor]';
    console.log(
      `${t.appId.padEnd(30)} ${String(t.port).padEnd(6)} ${(t.contextPath || '-').padEnd(14)} ${t.profile.padEnd(14)}${flag}`
    );
    if (!t.inReactor) {
      console.log(`    说明: ${t.note}`);
    }
  }

  const conflicts = computeConflicts(targets);
  console.log('');
  console.log(`端口冲突组数: ${conflicts.length}`);
  for (const c of conflicts) {
    console.log(`  ${c.port}: ${c.appIds.join(', ')}`);
  }

  const external = targets.filter((t) => !t.inReactor);
  const appsWithManyProfiles = targets.filter((t) => t.profiles.length >= 5);
  console.log('');
  console.log(`reactor 外应用: ${external.map((t) => t.appId).join(', ') || '(无)'}`);
  console.log(
    `profile 较多的应用: ${appsWithManyProfiles.map((t) => `${t.appId}(${t.profiles.length})`).join(', ') || '(无)'}`
  );

  // 可选：打印指定应用每个 profile 的生效端口，用于核对覆盖逻辑
  const detail = process.argv[2];
  if (detail) {
    const app = apps.find((a) => a.id === detail);
    if (app) {
      console.log('');
      console.log(`===== ${app.id} 各 profile 生效值 =====`);
      for (const profile of app.config.profiles) {
        const port = resolvePort(app.config, profile);
        const ctx = resolveContextPath(app.config, profile);
        console.log(`  ${(profile || '(无)').padEnd(16)} :${String(port).padEnd(6)} ${ctx || '-'}`);
      }
    }
  }
}

void main();
