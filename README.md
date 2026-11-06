# Web Boot Runner

一个用于 VS Code / Cursor 的 Spring Boot 应用管理扩展：在多模块 Maven 工作区中启动、停止应用，记住 profile、端口与主类，并在启动前检测端口冲突。

## 解决的问题

多模块仓库里常见的两类坑：

1. **reactor 归属**：不在 reactor 内的模块（`<module>` 被注释掉，或从未在父 POM 中声明）用 `mvn -pl :xxx` 会直接报 `Could not find the selected project in the reactor`。扩展会自动识别并改走 `mvn -f <模块>/pom.xml`。
2. **profile 与端口**：同一模块常有多个 `application-*.yml`，端口被 profile 覆盖；多个 Web 模块还可能默认共用 8080。扩展按「基础配置 + profile 配置」算出每个 profile 的生效端口，并在启动前检查占用。

## 为什么不用官方 Spring Boot Dashboard

| 对比项 | 官方 `vscjava.vscode-spring-boot-dashboard` | 本扩展 |
| --- | --- | --- |
| 启动方式 | `type: java` 直启，依赖 VS Code Java 语言服务器拼 classpath | `mvn spring-boot:run`，classpath 由 Maven 解析 |
| 多模块 | 依赖语言服务器导入结果，模块多时易 stale | 走 `-pl ... -am`，天然正确 |
| reactor 外模块 | 失败 | 自动降级为 `-f` |
| profile | `Run with Profile...` 只往 `vmArgs` 追加，容易被 `launch.json` 的 `args` 压制 | profile 直接写进命令，可在界面里选并记住 |
| 端口 | 只能读配置 | 读配置 + 冲突检测 + 一键换端口 |
| 停止 | 有 | 有，且按进程树结束（Windows 用 `taskkill /T /F`） |

如果模块的 `pom.xml` 配置了 `<useClasspathFile>true</useClasspathFile>`（用于规避 Windows 下 `spring-boot:run` 的 classpath 过长，`error=206`），本扩展会复用这条路径。

## 环境要求

| 项 | 说明 |
| --- | --- |
| 编辑器 | VS Code 1.75+ 或 Cursor |
| Maven / JDK | 跟随目标仓库自身的环境；个别模块需要不同版本时，用 `webBoot.javaHome` 覆盖 `JAVA_HOME` |
| Node.js | 仅构建扩展、运行自检时需要 |

## 安装

本扩展独立于业务仓库，位于 `D:\work\tools\vscode-web-boot`。

```bash
cd D:\work\tools\vscode-web-boot
npm install
npm run package
```

`npm run package` 会先构建再打包，产物为 `web-boot-runner-0.1.3.vsix`（版本号取自 `package.json`）。打包插件市场版本时追加 `--readme-path README.marketplace.md`。安装：

```bash
cursor --install-extension web-boot-runner-0.1.3.vsix
# 或
code --install-extension web-boot-runner-0.1.3.vsix
```

开发调试：在 `D:\work\tools\vscode-web-boot` 打开窗口，按 `F5` 选择预置的扩展开发配置，按提示指定目标工作区即可启动 Extension Development Host。

> 扩展本体脱离仓库后，`selfcheck` 系列脚本需要显式指定仓库根（见「自检」）。
> 扩展运行时仍然以「当前 VS Code 工作区根目录」为扫描目标，与扩展自身所在位置无关。

## 使用

打开包含 `pom.xml` 的工作区根目录后，左侧活动栏出现 **Web Boot** 图标，点开即为应用列表（下图模块名与端口仅为示意）：

```text
sample-web              dev    :8080   /sample-web
sample-report-web       dev    :8080   /sample-report
sample-monitor-server   dev    :9999   /monitor
```

- 点击节点：未运行则启动，运行中则打开浏览器
- 悬浮节点出现内联按钮：未运行时为启动 / 调试，运行中为打开 / 停止 / 重启
- 悬浮运行中的节点也会出现编辑按钮，随时调整下次启动的 profile / 端口 / 主类 / `-am`
- 右键菜单：选择 Profile 运行、指定端口运行、编辑 Profile / 端口 / 主类 / `-am`、移动到分组、复制启动命令
- 运行中的应用右键可「重新加载资源」，执行 `mvn process-resources` 把资源的改动拷入 `target/classes`，不重启进程
- 开启 `webBoot.coverage` 后，启动会自动挂 JaCoCo agent：树节点追加 `JaCoCo · 覆盖 45.2%`，右键「采样覆盖率」随时 dump 并生成报告，「打开覆盖率报告」在浏览器里看 HTML 明细
- 标题栏按钮：刷新、检查端口冲突、生成 launch.json、显示输出、新建分组
- 分组：手动创建分组后，把应用拖进分组即可归类；拖到「未分组」移出。分组标题显示应用数与端口冲突组数，右键或内联按钮可启动 / 调试 / 停止整组
- 底部状态栏：显示应用总数与运行中数量，点击定位到 Web Boot 视图
- 修改 `pom.xml` 或 `application*.yml` 后自动重新扫描，通常不需要手动刷新
- 启动前检查端口占用，被占用时可选择结束占用进程、自动换端口、仍用该端口或取消；占用者若是本扩展管理的应用则直接停止它（保留覆盖率 dump）

启动过程输出到「Web Boot」输出通道。`=====` 行之后的两行分别是预编译与启动命令，就绪后会打印访问地址：

```text
===== sample-web  dev  mvn -B -pl :sample-web -am -DskipTests spring-boot:run ... =====
[1/2] 预编译：mvn -B -pl :sample-web -am -DskipTests compile
[2/2] 启动：mvn -B -pl :sample-web -am -DskipTests spring-boot:run ...
[就绪] sample-web 已在 http://localhost:8082/sample-web 启动。
```

启动完成后，树节点与「打开」动作都以日志里的实际端口为准，而不是配置里的值。

运行中的应用每 5 秒刷新一次监控：树节点追加 `堆 34% · HTTP 200 8ms`（Actuator 可用时显示为 `Tomcat 5/200`），悬浮提示里能看到堆用量、YGC/FGC 次数与耗时、Tomcat 响应状态及线程池。监控只读，不会影响应用进程。

## 命令

| 命令 | 说明 |
| --- | --- |
| `Web Boot: 刷新应用列表` | 重新扫描 pom 与 application 配置 |
| `Web Boot: 运行` | 用记住的 profile / 端口 / 主类启动 |
| `Web Boot: 选择 Profile 运行...` | 从该模块的 `application-*.yml` 里选，选完会清掉记住的端口，让新 profile 的 yml 端口生效 |
| `Web Boot: 指定端口运行...` | 临时覆盖端口并记住 |
| `Web Boot: 编辑 Profile / 端口 / 主类 / -am / 覆盖率...` | 逐项修改记住的 profile、端口、主类、`-am` 开关与覆盖率开关，不启动进程；端口留空则回到配置文件的值，主类可选扫描到的候选或手动输入，`-am` 与覆盖率均可选跟随全局或按应用覆盖，运行中的实例重启后生效 |
| `Web Boot: 新建分组...` | 新建手动分组，之后可拖拽应用加入 |
| `Web Boot: 重命名分组...` / `删除分组` | 重命名或删除分组；删除分组只解除归类，不删除应用 |
| `Web Boot: 移动到分组...` | 通过菜单把某个应用移入分组或移出到「未分组」 |
| `Web Boot: 启动整组` / `调试整组` / `停止整组` | 按顺序启动（或带 JDWP 调试启动）组内未运行的应用并等待就绪；停止组内运行中的应用 |
| `Web Boot: 调试运行（自动 attach）` | 启动加 JDWP，Spring Boot 打出 `Started ...` 后自动 attach |
| `Web Boot: 停止` | `taskkill /T /F` 结束整棵进程树 |
| `Web Boot: 重启` | 停止后按记住的 profile / 端口 / 主类 / `-am` 重新启动；调试运行的应用仍以调试方式重启 |
| `Web Boot: 重新加载资源` | 对运行中的应用执行 `mvn process-resources`，把资源改动拷入 `target/classes`；不重启进程，执行中点「停止」可打断 |
| `Web Boot: 采样覆盖率` | 运行中先 dump 最新执行数据再出报告；已停止时直接用累积的 exec 重新出报告。需要本次启动挂了 JaCoCo agent |
| `Web Boot: 打开覆盖率报告` | 在浏览器中打开该应用最近一次生成的 HTML 报告（`index.html`） |
| `Web Boot: 在浏览器中打开` | 按 `端口 + context-path` 拼地址 |
| `Web Boot: 复制启动命令` | 复制到剪贴板，可贴进任意终端 |
| `Web Boot: 检查端口冲突` | 在输出窗口打印全部应用的有效端口与冲突组 |
| `Web Boot: 释放端口（结束占用进程）...` | 查询并结束占用指定端口的进程：优先识别 PID、进程名与命令行，确认后结束；占用者是本扩展运行中的应用时直接「停止」它 |
| `Web Boot: 生成 launch.json` | 写 `type: java` 配置到 `.vscode/launch.json`，只替换 `Web Boot: ` 前缀的条目 |
| `Web Boot: 显示输出窗口` | 打开输出通道 |

## 配置

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `webBoot.mavenCommand` | `mvn` | Maven 可执行文件 |
| `webBoot.preBuild` | `compile` | 启动前目标：`none` / `compile` / `package` / `install` |
| `webBoot.buildDependencies` | `true` | reactor 内是否追加 `-am`（同时构建依赖模块）。关闭后只构建目标模块，依赖需已 `install` 到本地仓库 |
| `webBoot.monitor` | `true` | 启动成功后每 5 秒采集 JVM 堆/GC 与 Tomcat HTTP 状态，显示在树节点与悬浮提示中 |
| `webBoot.debugPort` | `5005` | JDWP 端口，被占用自动 +1 |
| `webBoot.runner` | `outputChannel` | `outputChannel` 可检测就绪与停止；`terminal` 仅把命令送进终端 |
| `webBoot.autoAttach` | `true` | 调试运行时自动 attach |
| `webBoot.autoOpen` | `false` | 就绪后自动打开浏览器 |
| `webBoot.javaHome` | 空 | 覆盖启动进程的 `JAVA_HOME` |
| `webBoot.extraArgs` | `[]` | 追加 JVM 参数，如 `-Xmx2g` |
| `webBoot.coverage` | `false` | 启动时挂 JaCoCo agent（tcpserver 模式），停止 / 采样时先 dump 再结束进程，生成 HTML + XML 覆盖率报告。终端模式下不可用 |
| `webBoot.coveragePort` | `6300` | JaCoCo agent 的 tcpserver 端口，被占用自动 +1 |
| `webBoot.coverageJacocoVersion` | `0.8.13` | JaCoCo 版本（agent 与 CLI），首次启用时 `mvn dependency:get` 下载并缓存到 `.vscode/web-boot/jacoco/` |

每个应用的 profile / 端口 / 主类 / `-am` / 覆盖率覆盖和分组记在 `.vscode/web-boot.json`。该目录通常已被业务仓库的 `.gitignore` 忽略，属于个人配置：

```json
{
  "apps": {
    "sample-web": {
      "profile": "dev",
      "port": 8082,
      "mainClass": "com.example.SampleWebApplication",
      "buildDependencies": false,
      "coverage": true
    }
  },
  "groups": [
    { "name": "核心服务", "apps": ["sample-web", "sample-report-web"] },
    { "name": "工具", "apps": ["sample-monitor-server"] }
  ]
}
```

一个应用最多属于一个分组；未列入任何分组的应用显示在「未分组」下（仅在存在分组时出现）。

`buildDependencies` 是应用级覆盖：不写则跟随全局 `webBoot.buildDependencies`，写了 `true` / `false` 就只影响该应用。在「编辑 Profile / 端口 / 主类 / -am / 覆盖率...」里选择「跟随全局设置」会删掉该字段（写回时值为 `undefined`，JSON 中不再出现）。`coverage` 同理，跟随全局 `webBoot.coverage`。

## 实现要点

### reactor 判定必须先剥离 XML 注释

`pom.xml` 里被 `<!-- -->` 包住的 `<module>` 不是 reactor 成员。直接正则抓 `<module>` 会把被注释的模块误判为 reactor 内，启动时报错。`src/scanner/maven.ts` 先剥离注释再解析，并把注释掉的模块名单独收集，用于树上的提示文案。

### profile 端口按「基础 yml + profile yml 深合并」计算

- 基础文件取 `application.yml` / `application.yaml` / `application.properties`（部分旧模块使用 properties）
- `application-<profile>.*` 逐个与基础配置深合并，得到该 profile 的生效 `server.port` 与 `server.servlet.context-path`
- `application.yml` 用 `YAML.parseAllDocuments` 解析：配置里若出现 `---` 多文档，单文档解析会抛错并退化到 8080

### 就绪与失败判定

`src/runner/logParser.ts` 按行解析子进程输出：

- 就绪：`Started Xxx in N seconds`
- 实际端口：`Tomcat started on port(s): 8080`、`Netty started on port 8090`
- context-path：`with context path '/sample-web'`
- 失败：`APPLICATION FAILED TO START`、`BUILD FAILURE`、`Error starting ApplicationContext`
- 端口占用：`Port 8080 was already in use`、`Address already in use`

### 运行时监控

启动就绪后每 5 秒采集一次，结果只写运行期状态，不落盘：

- JVM：先用 `jps -l` 按主类找到真正的 Java 进程（`mvn` 的 pid 是 shell，不是 JVM），再用 `jstat -gc` 读堆使用量与 YGC/FGC。
- Tomcat：对访问地址发 `HEAD` 请求，任何 HTTP 响应（含 401/404/405）都视为存活，并记录响应耗时。
- 若应用暴露了 Actuator，额外请求 `/actuator/metrics/tomcat.threads.busy` 与 `tomcat.threads.config.max`，显示 Tomcat 线程池占用。

采集失败只在悬浮提示里注明原因，不会弹窗或中断应用。

### 运行时覆盖率（JaCoCo）

`webBoot.coverage = true`（或按应用覆盖）时，启动流程在 `spring-boot.run.jvmArguments` 里追加：

```text
-javaagent:<agent.jar>=output=tcpserver,address=127.0.0.1,port=6300,dumponexit=false,sessionid=<appId>
```

- **为什么必须显式 dump**：停止走 `taskkill /T /F`，JVM 不会执行 shutdown hook，`dumponexit` 拿不到数据。所以 agent 用 `tcpserver` 模式，停止 / 手动采样时先用 `jacococli dump` 连端口把执行数据拉出来，再杀进程。
- **exec 累积**：每次 dump 出的 exec 与历史 exec 用 `jacococli merge` 合并到 `.vscode/web-boot/coverage/<appId>/jacoco.exec`，多次启动 / 采样的数据不会互相覆盖。
- **报告**：`jacococli report` 同时生成 HTML（`html/index.html`）与 XML（`report.xml`），扩展解析 XML 里的报告级 counter，把行 / 分支 / 类命中率写进树节点与悬浮提示。
- **工具准备**：agent（`runtime` classifier）与 CLI（`nodeps`）从 Maven 本地仓库取，缺失时自动 `mvn dependency:get` 下载，副本缓存到 `.vscode/web-boot/jacoco/<version>/`。
- **降级策略**：覆盖率准备失败（缺 JDK、下载失败、`target/classes` 不存在等）只降级为「本次不启用覆盖率」，不影响应用启动；dump / 报告失败只记录原因，不中断停止流程。
- **限制**：只统计本模块 `target/classes` 的字节码（依赖模块的代码不计入）；终端模式（`webBoot.runner = terminal`）拿不到进程生命周期，不启用覆盖率；「复制启动命令」复制的是不含 agent 的原始命令。

### process-resources 与 devtools

「重新加载资源」只执行 `mvn ... process-resources`，模块选择与 `-am` 开关和启动命令一致。扩展默认在 `spring-boot.run.jvmArguments` 里加了 `-Dspring.devtools.restart.enabled=false`，所以拷贝完资源后应用不会自动重启，需要手动「重启」才能生效。

如果希望资源变化触发 devtools 热重启，在 `webBoot.extraArgs` 里加 `-Dspring.devtools.restart.enabled=true` —— extraArgs 排在默认参数之后，同名的 JVM 系统属性以最后一个为准。

### 开发仓库实测

在开发该扩展所用的多模块仓库上运行 `npm run selfcheck`（节选）：

```text
reactor 模块数: 77
可启动应用数: 14

mes-web                        8080   /mes-web       eos
mes-monitor-server             9999   /monitor       dev             [不在 reactor]
mes-agentscope                 8090   -              eos2            [不在 reactor]

端口冲突组数: 2
  8080: mes-dispatching-web, mes-platform-web, mes-report-web, mes-web
  8081: mes-flowable-web, mes-generator-hibernate
```

该仓库中 `mes-web` 的各 profile 端口：`dev` / `eos2` / `eos3` 为 8082，其余为 8080；多个 Web 模块默认共用 8080。

### 命令形态

reactor 内：

```bash
mvn -B -pl :sample-web -am -DskipTests spring-boot:run \
  -Dspring-boot.run.profiles=dev \
  -Dspring-boot.run.main-class=com.example.SampleWebApplication \
  -Dspring-boot.run.arguments=--server.port=8082 \
  "-Dspring-boot.run.jvmArguments=-Dspring.devtools.restart.enabled=false"
```

reactor 外：

```bash
mvn -B -f sample-monitor-server/pom.xml -DskipTests spring-boot:run \
  -Dspring-boot.run.profiles=dev \
  -Dspring-boot.run.main-class=com.example.monitor.MonitorServerApplication
```

主类默认取扫描结果；在「编辑 Profile / 端口 / 主类 / -am...」里可改为同模块的其它启动类或手动输入全限定名。

reactor 内的 `-am` 由 `webBoot.buildDependencies` 控制。关闭后命令变为 `mvn -B -pl :sample-web -DskipTests spring-boot:run ...`，只构建目标模块——适合依赖模块已安装、且 `-am` 会把无关模块一起拖慢甚至编译失败的仓库。

调试时在 `jvmArguments` 里追加：

```text
-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005
```

用 `suspend=n` 是因为「先 attach 再启动」会把整个启动流程挂住；代价是启动阶段的断点可能错过。

## 已知限制

- **终端模式不检测就绪**：`webBoot.runner = terminal` 时只负责把命令送进终端，不会自动 attach；节点会直接显示为运行中，且「停止」不会结束终端里的进程。
- **输出编码按行自动识别**：扩展逐行判断字节，整行是合法 UTF-8 就按 UTF-8 解，否则按 GBK 解，因此 Windows 上 JDK 8 应用（默认 `file.encoding=GBK`）的中文日志也能正常显示，无需改系统编码或切到终端模式。仅在 GBK 解码器不可用的极端环境（宿主 ICU 缺失）下退化为按 UTF-8 读取，此时中文仍可能乱码；就绪检测只依赖 ASCII 的 `Started ... in ... seconds`，任何情况下都不受影响。
- **不同模块可能需要不同 JDK / Maven**：例如 Boot 3.x 工程（parent 为 `spring-boot-starter-parent`）需要 JDK 17 与 Maven 3.6.3+，与仓库中 JDK 8 / Maven 3.3.9 的模块不同。用本机默认环境跑会报 `PluginIncompatibleException`，需要用 `webBoot.javaHome` 指向对应 JDK，并使用匹配的 Maven。
- **生成 launch.json 的 java 配置不保证能跑**：reactor 外的模块，VS Code Java 语言服务器可能未导入，`type: java` 直启会失败。这类模块请用本扩展的 `mvn` 路径。
- **监控依赖 JDK 工具**：`jps` / `jstat` 随 JDK 提供；只有 JRE 时 JVM 指标显示「监控不可用」，Tomcat HTTP 状态仍可显示。
- **Actuator 指标使用默认路径**：自定义 `management.server.port` 或 `management.endpoints.web.base-path` 时，Tomcat 线程池不会显示，但 HTTP 探活不受影响。
- **终端模式不监控**：`webBoot.runner = terminal` 时拿不到 Java 进程，也不会采集 JVM / Tomcat 指标。
- **覆盖率需要已编译字节码**：dump / 报告用 `java -jar jacococli` 执行（JDK / JRE 均可）；模块未编译（`target/classes` 不存在）时本次不启用覆盖率。终端模式下覆盖率不可用。

## 自检

扩展已移出仓库，扫描类自检必须告诉它仓库在哪（`--root` 或环境变量 `MES_REPO_ROOT`）：

```bash
npm run typecheck

# 扫描类：需要仓库根
npm run selfcheck -- --root D:/work/jt-mes/source/mes/mes-parent
npm run selfcheck:cmd -- --root D:/work/jt-mes/source/mes/mes-parent

# 与仓库无关，可直接跑
npm run selfcheck:parse   # 日志解析（就绪 / 端口 / context-path / 失败 / 端口占用）
npm run selfcheck:monitor # jstat / Actuator 指标解析
npm run selfcheck:proc    # 进程树停止后端口是否真正释放
npm run selfcheck:port    # 端口占用者识别（netstat / lsof / ss 解析）与结束进程
npm run selfcheck:encoding # 子进程输出编码（UTF-8 / GBK 按行自动识别）
npm run selfcheck:coverage # JaCoCo agent 参数 / dump / merge / report argv / report.xml 解析
```

也可以一次性设好环境变量，然后跑全部：

```powershell
$env:MES_REPO_ROOT = "D:/work/jt-mes/source/mes/mes-parent"
npm run selfcheck:all
```

解析顺序：`--root 参数` > `MES_REPO_ROOT` > 从脚本位置向上查找 > 从当前目录向上查找；都失败时给出带示例的报错。

自检脚本通过 esbuild 把 `vscode` 别名指向 `test/vscode-stub.ts`，因此不需要启动 VS Code 即可验证扫描逻辑。

已做过一次端到端冒烟（`-f` 分支），验证就绪、端口与 context-path 解析，以及停止后端口释放：

```text
PASS ready line: 2026-11-05 10:14:42 [main] INFO  c.c.p.m.m.MonitorServerApplication - Started MonitorServerApplication in 17.517 seconds
PASS port line: 2026-11-05 10:14:42 [main] INFO  o.s.b.w.e.tomcat.TomcatWebServer - Tomcat started on port(s): 9999 (http) with context path '/monitor'
PASS port 9999 released
```

## 目录结构

```text
D:\work\tools\vscode-web-boot\
├─ .vscode/                        F5 调试扩展自身（打开目标工作区）
├─ src/
│  ├─ extension.ts                 入口：树、命令、状态栏、文件监听
│  ├─ model/types.ts               领域模型
│  ├─ scanner/maven.ts             reactor 扫描（剥离 XML 注释）
│  ├─ scanner/bootApps.ts          @SpringBootApplication 扫描
│  ├─ scanner/springConfig.ts      profile / 端口 / context-path 解析
│  ├─ runner/command.ts            mvn 命令生成
│  ├─ runner/logParser.ts          启动日志解析（就绪 / 端口 / 失败）
│  ├─ runner/processManager.ts     子进程与进程树停止（输出按行识别 UTF-8 / GBK）
│  ├─ runner/launcher.ts           单应用生命周期
│  ├─ runner/monitor.ts            JVM / Tomcat 运行期监控
│  ├─ runner/coverage.ts           运行时覆盖率（JaCoCo agent / dump / merge / report）
│  ├─ debug/attach.ts              JDWP attach
│  ├─ views/appsTreeProvider.ts    侧边栏树
│  ├─ config/store.ts              .vscode/web-boot.json
│  ├─ commands/generateLaunchJson.ts
│  ├─ util/ports.ts                端口探测与冲突统计
│  ├─ util/portProcess.ts          端口占用者识别与结束（netstat / lsof / ss）
│  └─ util/jdk.ts                  JDK 工具定位（jps / jstat / java）与命令执行
├─ test/                           自检脚本（不打包）
├─ README.marketplace.md           插件市场双语 README
└─ media/
   ├─ web-boot.svg
   ├─ icon.svg                     市场图标源文件
   ├─ icon.png                     市场图标（256×256）
   ├─ ui-overview.png              插件市场界面示意图
   └─ donate-wechat.png            微信打赏二维码
```

## 支持

如果这个扩展帮你省下了时间，可以自愿微信扫码请作者喝杯咖啡。赞助完全自愿，不影响任何功能，也不构成任何形式的服务承诺。

<p align="center">
  <img src="media/donate-wechat.png" alt="微信打赏二维码" width="180" />
</p>

## 许可证

[MIT](LICENSE) © 2026 eppen
