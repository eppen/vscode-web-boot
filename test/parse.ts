/**
 * 日志解析自检：用真实日志与典型启动日志验证就绪/端口/失败识别。
 * 仅用于验证，不参与扩展打包。
 */
import { parseBootLogLine } from '../src/runner/logParser';

interface Case {
  name: string;
  line: string;
  expect: {
    ready?: boolean;
    failed?: boolean;
    portInUse?: boolean;
    port?: number;
    contextPath?: string;
  };
}

const cases: Case[] = [
  {
    name: '真实日志：MesApplication 就绪',
    // 取自 log/mes.log
    line: '2026-09-20 16:07:08.517 [Catalina-utility-2] INFO  c.cnrspc.projects.mes.MesApplication - Started MesApplication in 86.856 seconds (JVM running for 183486.389)',
    expect: { ready: true, failed: false }
  },
  {
    name: '真实日志：DispatchingApplication 就绪',
    line: '2026-09-20 16:04:46.481 [Catalina-utility-2] INFO  c.c.p.mes.DispatchingApplication - Started DispatchingApplication in 27.746 seconds (JVM running for 183344.348)',
    expect: { ready: true }
  },
  {
    name: '内嵌 Tomcat 端口与 context-path',
    line: "2026-11-05 09:00:00.123  INFO 12345 --- [main] o.s.b.w.embedded.tomcat.TomcatWebServer  : Tomcat started on port(s): 8082 (http) with context path '/mes-web'",
    expect: { port: 8082, contextPath: '/mes-web', ready: false }
  },
  {
    name: '内嵌 Tomcat 无 context-path',
    line: '2026-11-05 09:00:00.123  INFO 1 --- [main] o.s.b.w.embedded.tomcat.TomcatWebServer  : Tomcat started on port(s): 8080 (http) with context path \'\'',
    expect: { port: 8080, contextPath: '' }
  },
  {
    name: 'Netty 端口（WebFlux，mes-agentscope）',
    line: '2026-11-05 09:00:00.123  INFO 1 --- [main] o.s.b.web.embedded.netty.NettyWebServer  : Netty started on port 8090',
    expect: { port: 8090 }
  },
  {
    name: '启动失败',
    line: '*************************** APPLICATION FAILED TO START ***************************',
    expect: { failed: true, ready: false }
  },
  {
    name: '端口占用',
    line: 'Web server failed to start. Port 8080 was already in use.',
    expect: { portInUse: true }
  },
  {
    name: '普通业务日志不应误判',
    line: '2026-11-05 09:00:00.123  INFO 1 --- [http-nio-8080-exec-1] c.c.p.m.s.s.SysUserController  : 用户登录成功',
    expect: { ready: false, failed: false, portInUse: false }
  }
];

let failed = 0;

for (const testCase of cases) {
  const actual = parseBootLogLine(testCase.line);
  const mismatches: string[] = [];
  for (const [key, expected] of Object.entries(testCase.expect)) {
    const actualValue = (actual as Record<string, unknown>)[key];
    if (actualValue !== expected) {
      mismatches.push(`${key}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actualValue)}`);
    }
  }
  if (mismatches.length === 0) {
    console.log(`  PASS  ${testCase.name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${testCase.name}`);
    for (const mismatch of mismatches) {
      console.log(`        ${mismatch}`);
    }
  }
}

console.log('');
console.log(failed === 0 ? `全部通过（${cases.length} 条）` : `失败 ${failed} 条`);
process.exitCode = failed === 0 ? 0 : 1;
