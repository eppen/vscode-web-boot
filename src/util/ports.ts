/**
 * 端口工具：探测占用、寻找空闲端口、统计端口冲突。
 *
 * 本仓库 mes-web / mes-platform-web / mes-report-web / mes-dispatching-web
 * 默认都是 8080，同时跑必然冲突，所以要能提前提示。
 */
import * as net from 'net';
import type { BootApp } from '../model/types';
import { defaultProfile, resolveContextPath, resolvePort } from '../scanner/springConfig';

/** 端口是否可绑定 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    // 不指定 host，等价于监听全部网卡，和 Spring Boot 默认绑定行为一致
    server.listen(port);
  });
}

/** 从 start 开始找空闲端口 */
export async function findFreePort(start: number, maxTries = 100): Promise<number> {
  for (let port = start; port < start + maxTries; port++) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  return start;
}

export interface EffectiveTarget {
  appId: string;
  profile: string;
  port: number;
  contextPath: string;
}

/** 计算某个应用的生效目标（profile 优先取用户偏好） */
export function effectiveTarget(
  app: BootApp,
  preferredProfile?: string,
  preferredPort?: number
): EffectiveTarget {
  const profile = preferredProfile || defaultProfile(app.config);
  const port = preferredPort ?? resolvePort(app.config, profile);
  return {
    appId: app.id,
    profile,
    port,
    contextPath: resolveContextPath(app.config, profile)
  };
}

export interface PortConflict {
  port: number;
  appIds: string[];
}

/** 统计端口冲突（同一端口的应用数 > 1） */
export function computeConflicts(targets: EffectiveTarget[]): PortConflict[] {
  const byPort = new Map<number, string[]>();
  for (const t of targets) {
    const list = byPort.get(t.port) ?? [];
    list.push(t.appId);
    byPort.set(t.port, list);
  }
  const conflicts: PortConflict[] = [];
  for (const [port, appIds] of byPort) {
    if (appIds.length > 1) {
      conflicts.push({ port, appIds: appIds.sort() });
    }
  }
  return conflicts.sort((a, b) => a.port - b.port);
}
