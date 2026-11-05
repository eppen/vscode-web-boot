/**
 * 命令生成自检：验证 -pl/-am 分支与 -f 分支、-am 开关、端口覆盖、调试参数、引号处理。
 * 仅用于验证，不参与扩展打包。
 */
import { scanReactor } from '../src/scanner/maven';
import { scanBootApps } from '../src/scanner/bootApps';
import { defaultProfile, resolvePort } from '../src/scanner/springConfig';
import { buildCommandPlan, buildProcessResourcesCommand } from '../src/runner/command';
import { findRepoRoot } from './root';
import { setScanRoot } from './vscode-stub';

async function main(): Promise<void> {
  const root = findRepoRoot(__dirname);
  setScanRoot(root);
  const reactor = scanReactor(root);
  const apps = await scanBootApps(root, reactor);
  const opts = {
    mavenCommand: 'mvn',
    preBuild: 'compile' as const,
    extraJvmArgs: ['-Xmx2g'],
    buildDependencies: true
  };

  for (const id of ['mes-web', 'mes-monitor-server', 'mes-agentscope', 'eos-nwf-web']) {
    const app = apps.find((a) => a.id === id);
    if (!app) {
      console.log(`${id}: 未找到`);
      continue;
    }
    const profile = defaultProfile(app.config);
    const plan = buildCommandPlan(
      {
        app,
        profile,
        port: resolvePort(app.config, profile),
        mainClass: app.mainClass,
        debug: false
      },
      opts
    );
    console.log(`=== ${id} (profile=${profile}, inReactor=${app.inReactor}) ===`);
    if (plan.preBuildLine) {
      console.log(`  预编译: ${plan.preBuildLine}`);
    }
    console.log(`  启动  : ${plan.runLine}`);
  }

  const app = apps.find((a) => a.id === 'mes-web');
  if (app) {
    const plan = buildCommandPlan(
      {
        app,
        profile: 'eos2',
        port: 9090,
        mainClass: app.mainClass,
        debug: true,
        debugPort: 5005
      },
      opts
    );
    console.log('');
    console.log('=== mes-web 调试 + 指定端口 ===');
    console.log(`  ${plan.runLine}`);

    const defaultProf = defaultProfile(app.config);
    const noAmPlan = buildCommandPlan(
      {
        app,
        profile: defaultProf,
        port: resolvePort(app.config, defaultProf),
        mainClass: app.mainClass,
        debug: false
      },
      { ...opts, buildDependencies: false }
    );
    console.log('');
    console.log('=== mes-web 关闭 -am ===');
    console.log(`  ${noAmPlan.runLine}`);

    console.log('');
    console.log('=== mes-web process-resources ===');
    console.log(
      `  含 -am: ${buildProcessResourcesCommand(
        { app, profile: defaultProf, mainClass: app.mainClass, debug: false },
        opts
      )}`
    );
    console.log(
      `  无 -am: ${buildProcessResourcesCommand(
        { app, profile: defaultProf, mainClass: app.mainClass, debug: false },
        { ...opts, buildDependencies: false }
      )}`
    );
  }
}

void main();
