/**
 * 解析 Spring Boot 启动日志，识别端口、context-path、就绪与失败信号。
 *
 * 单独抽出来便于用真实日志样本做自检（见 test/parse.ts）。
 */
export interface BootLogSignals {
  /** Tomcat/Netty/Jetty 实际监听端口 */
  port?: number;
  /** context-path */
  contextPath?: string;
  /** 出现 "Started Xxx in N seconds" */
  ready: boolean;
  /** 出现 APPLICATION FAILED TO START 等失败特征 */
  failed: boolean;
  /** 端口被占用 */
  portInUse: boolean;
  /** spring-boot:run 被跳过（pom 中 spring-boot.run.skip=true 且未被命令行覆盖） */
  skipped: boolean;
}

/** 就绪：Started MesApplication in 12.345 seconds (JVM running for 15.1) */
const READY_RE = /Started\s+\S+\s+in\s+[\d.]+\s+seconds/;
/** 端口：Tomcat 为 "started on port(s): 8080"，Netty 为 "started on port 8090" */
const PORT_RE = /(?:Tomcat|Netty|Jetty)\s+started on port(?:\(s\))?:?\s*(\d+)/i;
/** context path：with context path '/mes-web' */
const CONTEXT_RE = /with context path '([^']*)'/;
/** 失败特征 */
const FAILED_RE = /APPLICATION FAILED TO START|BUILD FAILURE|Error starting ApplicationContext/;
/** 端口占用 */
const PORT_IN_USE_RE = /Port \d+ was already in use|Address already in use/i;
/** spring-boot:run 被跳过（插件打印 "Skipping run of application"） */
const SKIP_RE = /Skipping run of application/i;

export function parseBootLogLine(line: string): BootLogSignals {
  const signals: BootLogSignals = {
    ready: READY_RE.test(line),
    failed: FAILED_RE.test(line),
    portInUse: PORT_IN_USE_RE.test(line),
    skipped: SKIP_RE.test(line)
  };
  const portMatch = line.match(PORT_RE);
  if (portMatch) {
    signals.port = Number(portMatch[1]);
  }
  const contextMatch = line.match(CONTEXT_RE);
  if (contextMatch) {
    signals.contextPath = contextMatch[1];
  }
  return signals;
}
