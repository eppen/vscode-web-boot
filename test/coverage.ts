/**
 * 覆盖率自检：验证 JaCoCo agent 参数、dump / merge / report 的 argv，
 * 以及 report.xml 解析（只取报告级 counter，忽略嵌套层级与注释里的伪标签）。
 * 仅用于验证，不参与扩展打包。
 */
import {
  buildDumpArgs,
  buildJacocoAgentArg,
  buildMergeArgs,
  buildReportArgs,
  parseJacocoXml,
  resolveCoverageEnabled
} from '../src/runner/coverage';

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

// ---------- resolveCoverageEnabled：应用偏好 > 全局设置 ----------
check('全局关、无应用偏好 -> 关', resolveCoverageEnabled(false, undefined), false);
check('全局开、无应用偏好 -> 开', resolveCoverageEnabled(true, undefined), true);
check('全局开、应用显式关 -> 关', resolveCoverageEnabled(true, false), false);
check('全局关、应用显式开 -> 开', resolveCoverageEnabled(false, true), true);
check('全局未设置(undefined) -> 关', resolveCoverageEnabled(undefined, undefined), false);

// ---------- buildJacocoAgentArg ----------
check(
  'agent 基本参数（tcpserver + dumponexit=false）',
  buildJacocoAgentArg({ jar: 'C:/tools/jacoco/agent.jar', port: 6300, sessionId: 'mes-web' }),
  '-javaagent:C:/tools/jacoco/agent.jar=output=tcpserver,address=127.0.0.1,port=6300,dumponexit=false,sessionid=mes-web'
);
check(
  'jar 路径含空格时加引号',
  buildJacocoAgentArg({ jar: 'C:/Program Files/jacoco/agent.jar', port: 6301 }),
  '-javaagent:"C:/Program Files/jacoco/agent.jar"=output=tcpserver,address=127.0.0.1,port=6301,dumponexit=false,sessionid=webboot'
);
check(
  'sessionid 清洗 , 与 =',
  buildJacocoAgentArg({ jar: 'a.jar', port: 1, sessionId: 'a,b=c' }),
  '-javaagent:a.jar=output=tcpserver,address=127.0.0.1,port=1,dumponexit=false,sessionid=a_b_c'
);
check(
  'includes 用冒号连接',
  buildJacocoAgentArg({ jar: 'a.jar', port: 1, includes: ['com.example.*', 'org.foo.*'] }),
  '-javaagent:a.jar=output=tcpserver,address=127.0.0.1,port=1,dumponexit=false,sessionid=webboot,includes=com.example.*:org.foo.*'
);
check(
  'includes 空项被过滤',
  buildJacocoAgentArg({ jar: 'a.jar', port: 1, includes: ['  ', ''] }),
  '-javaagent:a.jar=output=tcpserver,address=127.0.0.1,port=1,dumponexit=false,sessionid=webboot'
);

// ---------- buildDumpArgs / buildMergeArgs / buildReportArgs ----------
check(
  'dump argv',
  buildDumpArgs({ cliJar: 'cli.jar', port: 6300, dest: 'out.exec' }),
  ['-jar', 'cli.jar', 'dump', '--address', '127.0.0.1', '--port', '6300', '--destfile', 'out.exec']
);
check(
  'merge argv（多文件）',
  buildMergeArgs({ cliJar: 'cli.jar', files: ['a.exec', 'b.exec'], dest: 'merged.exec' }),
  ['-jar', 'cli.jar', 'merge', 'a.exec', 'b.exec', '--destfile', 'merged.exec']
);
check(
  'report argv（HTML + XML + name）',
  buildReportArgs({
    cliJar: 'cli.jar',
    exec: 'jacoco.exec',
    classfiles: ['m1/target/classes', 'm2/target/classes'],
    sourcefiles: ['m1/src/main/java'],
    htmlDir: 'html',
    xmlFile: 'report.xml',
    name: 'mes-web'
  }),
  [
    '-jar',
    'cli.jar',
    'report',
    'jacoco.exec',
    '--classfiles',
    'm1/target/classes',
    'm2/target/classes',
    '--sourcefiles',
    'm1/src/main/java',
    '--html',
    'html',
    '--xml',
    'report.xml',
    '--name',
    'mes-web'
  ]
);
check(
  'report argv（无 classfiles / sourcefiles / name 时省略对应参数）',
  buildReportArgs({ cliJar: 'cli.jar', exec: 'e.exec', classfiles: [], sourcefiles: [], htmlDir: 'h', xmlFile: 'r.xml' }),
  ['-jar', 'cli.jar', 'report', 'e.exec', '--html', 'h', '--xml', 'r.xml']
);

// ---------- parseJacocoXml ----------
const REALISTIC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd">
<report name="mes-web">
  <sessioninfo id="mes-web" start="1700000000000" dump="1700000060000"/>
  <!-- <counter type="LINE" missed="1" covered="999"/> 注释里的伪标签不能生效 -->
  <package name="com/example">
    <class name="com/example/Foo" sourcefilename="Foo.java">
      <method name="bar" desc="()V" line="10">
        <counter type="INSTRUCTION" missed="10" covered="0"/>
      </method>
      <counter type="LINE" missed="5" covered="5"/>
    </class>
    <sourcefile name="Foo.java">
      <line nr="10" mi="10" ci="0" mb="0" cb="0"/>
    </sourcefile>
    <counter type="LINE" missed="5" covered="5"/>
  </package>
  <counter type="INSTRUCTION" missed="100" covered="900"/>
  <counter type="BRANCH" missed="30" covered="70"/>
  <counter type="LINE" missed="50" covered="150"/>
  <counter type="COMPLEXITY" missed="20" covered="80"/>
  <counter type="METHOD" missed="5" covered="45"/>
  <counter type="CLASS" missed="10" covered="90"/>
</report>`;

const parsed = parseJacocoXml(REALISTIC_XML);
check('行覆盖率 150/200 = 75%', parsed.line, { covered: 150, missed: 50, rate: 75 });
check('分支覆盖率 70/100 = 70%', parsed.branch, { covered: 70, missed: 30, rate: 70 });
check('类覆盖率 90/100 = 90%', parsed.clazz, { covered: 90, missed: 10, rate: 90 });
check('updatedAt 是数字', typeof parsed.updatedAt === 'number', true);

// 多模块报告：group 包裹时，报告级 counter 仍是 <report> 直属
const GROUPED_XML = `<report name="multi">
  <group name="mes-web">
    <package name="com/example">
      <counter type="LINE" missed="999" covered="1"/>
    </package>
    <counter type="LINE" missed="999" covered="1"/>
  </group>
  <counter type="LINE" missed="10" covered="90"/>
  <counter type="BRANCH" missed="0" covered="0"/>
  <counter type="CLASS" missed="1" covered="9"/>
</report>`;
const grouped = parseJacocoXml(GROUPED_XML);
check('group 内 counter 不污染报告级（行 90/100）', grouped.line, { covered: 90, missed: 10, rate: 90 });
check('总数为 0 的 counter rate 为 undefined', grouped.branch, { covered: 0, missed: 0, rate: undefined });
check('类 9/10 = 90%', grouped.clazz, { covered: 9, missed: 1, rate: 90 });

// 空输入 / 无 counter：降级为 0 命中，不抛错
const empty = parseJacocoXml('');
check('空输入降级为 0 命中', empty.line, { covered: 0, missed: 0, rate: undefined });
check('空输入 updatedAt 仍是数字', typeof empty.updatedAt === 'number', true);
const noCounter = parseJacocoXml('<report name="x"><package name="a"/></report>');
check('无 counter 时保持 0 命中', noCounter.clazz, { covered: 0, missed: 0, rate: undefined });

console.log('');
console.log(failed === 0 ? '全部通过' : `失败 ${failed} 项`);
process.exitCode = failed === 0 ? 0 : 1;
