/**
 * 监控解析自检：jstat -gc 表头映射（JDK 8 / 17）与 Actuator 指标解析。
 * 仅用于验证，不参与扩展打包。
 */
import { parseActuatorValue, parseJstatGc } from '../src/runner/monitor';

let failed = 0;

function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    failed++;
    console.error(`FAIL ${message}`);
  }
}

function near(actual: number | undefined, expected: number, message: string): void {
  check(
    actual !== undefined && Math.abs(actual - expected) < 0.001,
    `${message}（实际 ${actual}）`
  );
}

// JDK 17：带 CGC / CGCT 列
const jdk17 = `
    S0C         S1C         S0U         S1U          EC           EU           OC           OU          MC         MU       CCSC      CCSU     YGC     YGCT     FGC    FGCT     CGC    CGCT       GCT
   1024.0         0.0       512.0         0.0       8192.0       4096.0      16384.0       8192.0      4096.0     2048.0      512.0     256.0      3     0.123      1     0.456      0     0.000     0.579
`;
const jdk17Metrics = parseJstatGc(jdk17);
check(jdk17Metrics !== undefined, 'JDK 17 输出可解析');
near(jdk17Metrics?.heapUsedK, 12800, 'JDK 17 已用堆 = S0U + S1U + EU + OU');
near(jdk17Metrics?.heapCommittedK, 25600, 'JDK 17 已提交堆 = S0C + S1C + EC + OC');
near(jdk17Metrics?.heapUsedPercent, 50, 'JDK 17 堆使用率 50%');
near(jdk17Metrics?.ygc, 3, 'JDK 17 YGC');
near(jdk17Metrics?.fgc, 1, 'JDK 17 FGC');
near(jdk17Metrics?.gct, 0.579, 'JDK 17 GCT');

// JDK 8：无 CGC / CGCT 列，且受 locale 影响使用逗号小数
const jdk8 = `
 S0C    S1C    S0U    S1U      EC       EU        OC         OU       MC     MU    CCSC   CCSU   YGC     YGCT    FGC    FGCT     GCT
 512.0  512.0  256.0    0.0   4096.0   1024.0    8192.0     2048.0   2048.0  1024.0  256.0  128.0      2     0,045     0     0,000     0,045
`;
const jdk8Metrics = parseJstatGc(jdk8);
check(jdk8Metrics !== undefined, 'JDK 8 输出可解析');
near(jdk8Metrics?.heapUsedK, 3328, 'JDK 8 已用堆');
near(jdk8Metrics?.heapCommittedK, 13312, 'JDK 8 已提交堆');
near(jdk8Metrics?.ygct, 0.045, '逗号小数被识别');

check(parseJstatGc('not a jstat output') === undefined, '非法输出返回 undefined');

// Actuator 指标
const actuator = JSON.stringify({
  name: 'tomcat.threads.busy',
  measurements: [{ statistic: 'VALUE', value: 7.0 }]
});
near(parseActuatorValue(actuator), 7, 'Actuator busy 线程数');
check(parseActuatorValue('{}') === undefined, '缺少 measurements 返回 undefined');
check(parseActuatorValue('not json') === undefined, '非法 JSON 返回 undefined');

if (failed > 0) {
  console.error(`\n${failed} 项失败`);
  process.exitCode = 1;
} else {
  console.log('\n全部通过');
}
