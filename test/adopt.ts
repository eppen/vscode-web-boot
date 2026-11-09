/**
 * 跨会话接管自检（端到端，带真实子进程）：
 * 1. adopt：pid 还活着时把应用恢复成「运行中」，并带上端口 / 上次命令
 * 2. adopt：pid 已结束（进程不存在）时返回 false，状态保持未运行
 * 3. snapshot：接管来的进程会被写进快照（下次重启还能继续接管）
 * 4. stop：接管来的进程没有句柄，仍能按 pid 结束
 * 仅用于验证，不参与扩展打包。
 */
import { spawn, type ChildProcess } from 'child_process';
import { setConfig } from './vscode-stub';
import { BootRunner } from '../src/runner/launcher';
import type { BootApp } from '../src/model/types';
import { isPidAlive } from '../src/util/portProcess';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 起一个不会自己退出的子进程，模拟上一会话遗留的 mvn / java */
function startOrphan(): ChildProcess {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true
  });
}

const app: BootApp = {
  id: 'mes-web',
  dir: process.cwd(),
  relDir: '.',
  mainClass: 'com.example.DemoApplication',
  mainClassFile: '',
  inReactor: true,
  packaging: 'jar',
  config: {
    baseProfiles: [],
    profiles: [],
    ports: {},
    contextPaths: {},
    baseContextPath: ''
  }
};

const output = { appendLine: (): void => undefined, show: (): void => undefined };

(async (): Promise<void> => {
  // 监控靠 jps 找 java 进程，自检里关掉避免干扰
  setConfig({ monitor: false });

  const runner = new BootRunner(process.cwd(), output as never);
  const orphan = startOrphan();
  const pid = orphan.pid;
  checkTrue('模拟的遗留进程已启动', typeof pid === 'number' && isPidAlive(pid as number));

  // ---------- adopt ----------
  const adopted = await runner.adopt(app, {
    appId: app.id,
    state: 'running',
    pid: pid as number,
    port: 18080,
    contextPath: '/api',
    profile: 'dev',
    debug: false,
    startedAt: 1_700_000_000_000,
    lastCommand: 'mvn spring-boot:run -pl mes-web'
  });
  check('adopt 成功', adopted, true);
  const rt = runner.getRuntime(app.id);
  check('状态恢复为 running', rt.state, 'running');
  check('端口沿用快照', rt.port, 18080);
  check('contextPath 沿用快照', rt.contextPath, '/api');
  check('profile 沿用快照', rt.profile, 'dev');
  check('pid 沿用快照', rt.pid, pid);
  check('上次命令沿用快照', rt.lastCommand, 'mvn spring-boot:run -pl mes-web');
  check('标记为接管', runner.isAdopted(app.id), true);

  // ---------- snapshot ----------
  const snapshot = runner.snapshot();
  check('快照条数', snapshot.length, 1);
  check('快照 appId', snapshot[0]?.appId, app.id);
  check('快照 pid', snapshot[0]?.pid, pid);
  check('快照状态', snapshot[0]?.state, 'running');

  // ---------- 重复接管被拒绝 ----------
  check('运行中不会被重复接管', await runner.adopt(app, {
    appId: app.id,
    state: 'running',
    pid: pid as number,
    debug: false
  }), false);

  // ---------- stop ----------
  await runner.stop(app.id);
  check('停止后状态', runner.getRuntime(app.id).state, 'stopped');
  check('停止后清掉接管标记', runner.isAdopted(app.id), false);
  await sleep(500);
  check('进程已被结束', isPidAlive(pid as number), false);
  check('停止后快照为空', runner.snapshot().length, 0);

  // ---------- pid 不存在时拒绝接管 ----------
  const dead = startOrphan();
  const deadPid = dead.pid as number;
  dead.kill();
  await new Promise<void>((resolve) => {
    if (dead.exitCode !== null || dead.signalCode !== null) {
      resolve();
      return;
    }
    dead.once('exit', () => resolve());
  });
  await sleep(300);
  const staleRunner = new BootRunner(process.cwd(), output as never);
  check('pid 不存在时接管失败', await staleRunner.adopt(app, {
    appId: app.id,
    state: 'running',
    pid: deadPid,
    debug: false
  }), false);
  check('未接管的记录不会被写进快照', staleRunner.snapshot().length, 0);
  check('状态保持未运行', staleRunner.getRuntime(app.id).state, 'stopped');
  staleRunner.dispose();

  runner.dispose();
  console.log('');
  console.log(failed === 0 ? '全部通过' : `失败 ${failed} 项`);
  process.exitCode = failed === 0 ? 0 : 1;
})();
