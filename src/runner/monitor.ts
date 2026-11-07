/**
 * 运行时监控：应用就绪后周期性采集 JVM 与 Tomcat 指标。
 *
 * - JVM：用同一 JDK 的 jps 找到 Java 进程（mvn 是 shell 子进程，pid 不是 Java 的），
 *   再用 jstat -gc 读取堆使用量与 GC 次数/耗时。
 * - Tomcat：对访问地址发 HEAD 请求判断存活并测量响应时间；
 *   若应用暴露了 Spring Boot Actuator，再读取 Tomcat 线程池 busy / max。
 *
 * 采集失败不打断应用，只把原因写进 metrics，由树节点悬浮提示展示。
 */
import * as http from 'http';
import * as vscode from 'vscode';
import type { AppMetrics, JvmMetrics, TomcatMetrics } from '../model/types';
import { execText, resolveJdkTool } from '../util/jdk';
import { t } from '../i18n';

export const MONITOR_INTERVAL_MS = 5000;
const HTTP_TIMEOUT_MS = 2500;
const ACTUATOR_TIMEOUT_MS = 1500;
const MAX_BODY = 64 * 1024;

export interface MonitorStartOptions {
  /** 应用主类，用于从 jps 输出中定位 Java 进程 */
  mainClass: string;
  /** 应用访问地址，用于 Tomcat 探活与 Actuator 指标 */
  url?: string;
  /** 启动进程使用的 JAVA_HOME，优先从中找 jps / jstat */
  javaHome: string;
}

interface MonitorContext {
  mainClass: string;
  url?: string;
  jps: string;
  jstat: string;
  javaPid?: number;
  timer: NodeJS.Timeout;
  generation: number;
  /** Actuator 是否可用；undefined 表示尚未探测出结果 */
  actuator?: boolean;
}

export interface MetricsUpdate {
  appId: string;
  metrics: AppMetrics;
}

interface HttpResult {
  status?: number;
  body?: string;
  error?: string;
  latencyMs: number;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return t('error.jpsNotFound');
    }
    return err.message;
  }
  return String(err);
}

/**
 * 解析 jstat -gc 输出。
 * 表头按列名映射，兼容 JDK 8（无 CGC/CGCT）与 JDK 11+ 的不同列数。
 */
export function parseJstatGc(output: string): JvmMetrics | undefined {
  const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headerIndex = lines.findIndex(
    (line) => /\bYGC\b/.test(line) && /\bGCT\b/.test(line)
  );
  if (headerIndex < 0) {
    return undefined;
  }
  const headers = lines[headerIndex].trim().split(/\s+/);
  const dataLine = lines
    .slice(headerIndex + 1)
    .find((line) => /^\s*-?[\d.,]+(\s|$)/.test(line));
  if (!dataLine) {
    return undefined;
  }
  const values = dataLine.trim().split(/\s+/);
  const record: Record<string, number> = {};
  headers.forEach((header, index) => {
    const raw = values[index];
    if (raw === undefined) {
      return;
    }
    // 部分 JDK 受 locale 影响会输出逗号小数
    const num = Number(raw.replace(',', '.'));
    if (Number.isFinite(num)) {
      record[header] = num;
    }
  });

  const num = (key: string): number => record[key] ?? 0;
  const heapUsedK = num('S0U') + num('S1U') + num('EU') + num('OU');
  const heapCommittedK = num('S0C') + num('S1C') + num('EC') + num('OC');
  const metrics: JvmMetrics = {
    heapUsedK: Math.round(heapUsedK),
    heapCommittedK: Math.round(heapCommittedK)
  };
  if (heapCommittedK > 0) {
    metrics.heapUsedPercent = (heapUsedK / heapCommittedK) * 100;
  }
  const optional: Array<[keyof JvmMetrics, string]> = [
    ['ygc', 'YGC'],
    ['ygct', 'YGCT'],
    ['fgc', 'FGC'],
    ['fgct', 'FGCT'],
    ['gct', 'GCT']
  ];
  for (const [key, column] of optional) {
    if (record[column] !== undefined) {
      metrics[key] = record[column];
    }
  }
  return metrics;
}

/** 执行 jstat -gc；导出便于自检 */
export async function readJvmMetrics(jstat: string, javaPid: number): Promise<JvmMetrics> {
  const output = await execText(jstat, [
    '-J-Duser.language=en',
    '-J-Duser.country=US',
    '-gc',
    String(javaPid)
  ]);
  const metrics = parseJstatGc(output);
  if (!metrics) {
    throw new Error(t('error.jstatParse'));
  }
  return metrics;
}

function httpProbe(
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number
): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (result: Omit<HttpResult, 'latencyMs'>): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ ...result, latencyMs: Date.now() - started });
    };

    let req: http.ClientRequest;
    try {
      req = http.request(url, { method, timeout: timeoutMs }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (body.length < MAX_BODY) {
            body += chunk;
          }
        });
        res.on('end', () => finish({ status: res.statusCode, body }));
        res.on('error', (err) => finish({ status: res.statusCode, error: err.message }));
      });
    } catch (err) {
      finish({ error: errorMessage(err) });
      return;
    }
    req.on('timeout', () => {
      req.destroy();
      finish({ error: t('common.timeout') });
    });
    req.on('error', (err) => finish({ error: err.message }));
    req.end();
  });
}

/** 从 Actuator 指标响应中取出 measurements[0].value */
export function parseActuatorValue(body: string | undefined): number | undefined {
  if (!body) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(body) as {
      measurements?: Array<{ value?: unknown }>;
    };
    const value = parsed?.measurements?.[0]?.value;
    return typeof value === 'number' ? value : undefined;
  } catch {
    return undefined;
  }
}

async function probeTomcat(
  baseUrl: string,
  ctx: MonitorContext
): Promise<TomcatMetrics> {
  const head = await httpProbe(baseUrl, 'HEAD', HTTP_TIMEOUT_MS);
  const metrics: TomcatMetrics = {
    // 任何 HTTP 响应（含 401/403/404/405）都说明 Tomcat 仍在服务
    ok: head.status !== undefined,
    status: head.status,
    latencyMs: head.latencyMs,
    error: head.error
  };
  if (!metrics.ok || ctx.actuator === false) {
    return metrics;
  }

  // 默认路径；management.server 使用独立端口时不适用，失败后不再重试
  const busy = await httpProbe(
    `${baseUrl}/actuator/metrics/tomcat.threads.busy`,
    'GET',
    ACTUATOR_TIMEOUT_MS
  );
  if (busy.status === 200) {
    ctx.actuator = true;
    metrics.busyThreads = parseActuatorValue(busy.body);
    const max = await httpProbe(
      `${baseUrl}/actuator/metrics/tomcat.threads.config.max`,
      'GET',
      ACTUATOR_TIMEOUT_MS
    );
    if (max.status === 200) {
      metrics.maxThreads = parseActuatorValue(max.body);
    }
  } else if (!busy.error && ctx.actuator === undefined) {
    ctx.actuator = false;
  }
  return metrics;
}

export class MetricsMonitor implements vscode.Disposable {
  private readonly contexts = new Map<string, MonitorContext>();
  private readonly polling = new Set<string>();
  private readonly generation = new Map<string, number>();
  private readonly emitter = new vscode.EventEmitter<MetricsUpdate>();

  readonly onDidUpdate = this.emitter.event;

  start(appId: string, opts: MonitorStartOptions): void {
    this.stop(appId);
    const generation = (this.generation.get(appId) ?? 0) + 1;
    this.generation.set(appId, generation);

    const ctx: MonitorContext = {
      mainClass: opts.mainClass,
      url: opts.url,
      jps: resolveJdkTool(opts.javaHome, 'jps'),
      jstat: resolveJdkTool(opts.javaHome, 'jstat'),
      generation,
      timer: setInterval(() => {
        void this.poll(appId, generation);
      }, MONITOR_INTERVAL_MS)
    };
    this.contexts.set(appId, ctx);
    void this.poll(appId, generation);
  }

  stop(appId: string): void {
    const ctx = this.contexts.get(appId);
    if (ctx) {
      clearInterval(ctx.timer);
      this.contexts.delete(appId);
    }
    this.generation.set(appId, (this.generation.get(appId) ?? 0) + 1);
  }

  private async findJavaPid(ctx: MonitorContext): Promise<number | undefined> {
    const output = await execText(ctx.jps, ['-l']);
    for (const line of output.split(/\r?\n/)) {
      const match = /^(\d+)\s+(.+)$/.exec(line.trim());
      if (match && match[2].trim() === ctx.mainClass) {
        return Number(match[1]);
      }
    }
    return undefined;
  }

  private async poll(appId: string, generation: number): Promise<void> {
    const ctx = this.contexts.get(appId);
    if (!ctx || ctx.generation !== generation || this.polling.has(appId)) {
      return;
    }
    this.polling.add(appId);
    try {
      const metrics: AppMetrics = { updatedAt: Date.now() };

      if (!ctx.mainClass) {
        metrics.jvmError = t('error.noMainClass');
      } else {
        try {
          if (ctx.javaPid === undefined) {
            ctx.javaPid = await this.findJavaPid(ctx);
          }
          if (ctx.javaPid === undefined) {
            metrics.jvmError = t('error.javaProcessNotFound', ctx.mainClass);
          } else {
            metrics.jvm = await readJvmMetrics(ctx.jstat, ctx.javaPid);
          }
        } catch (err) {
          metrics.jvmError = errorMessage(err);
          // jstat 失败可能是进程已退出；下一轮重新用 jps 定位
          ctx.javaPid = undefined;
        }
      }

      if (ctx.url) {
        metrics.tomcat = await probeTomcat(ctx.url, ctx);
      }

      if (ctx.generation !== generation) {
        return;
      }
      this.emitter.fire({ appId, metrics });
    } finally {
      this.polling.delete(appId);
    }
  }

  dispose(): void {
    for (const appId of Array.from(this.contexts.keys())) {
      this.stop(appId);
    }
    this.emitter.dispose();
  }
}
