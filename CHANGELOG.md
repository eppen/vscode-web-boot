# Changelog

本扩展遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## Unreleased

## 0.1.8

### Added

- 运行期状态持久化到 `workspaceState`：VS Code / VSCodium 重载窗口或重启后自动「接管」上一会话遗留的 Spring Boot 进程，树节点恢复为运行中，端口、context-path、profile、上次命令与覆盖率上下文一并还原，无需重新启动应用
- 接管项每 15 秒巡检一次 pid，进程在编辑器之外被结束时自动刷新为未运行
- 接管后的应用仍可采样 / dump JaCoCo 覆盖率，「停止」按进程树结束（Windows `taskkill /T`，POSIX 按进程组）
- `npm run selfcheck:state`：快照清洗与读回（坏数据退化为空数组、pid 校验）
- `npm run selfcheck:adopt`：真实子进程的接管 / 重复接管拒绝 / 停止后进程结束（端到端自检）

### Changed

- 关闭窗口或退出编辑器不再结束正在运行的应用（此前 `deactivate` 会 `stopAll`）；需要结束请用「停止」命令
- 接管来的进程没有句柄，重载后拿不到此前的输出日志，想看日志需「重启」应用

## 0.1.7

### Added

- 左侧活动栏的 Web Boot 图标新增数量角标：显示「运行中 + 启动中」的应用数（角标悬停提示为「N 运行中 / M 启动中」），没有应用在运行时自动隐藏

## 0.1.6

### Added

- 界面多语言支持（简体中文 / 英文 / 日文）：新增 `webBoot.language`（`auto` / `zh-cn` / `en` / `ja`），默认跟随 VS Code 显示语言
- `package.nls*.json` 清单本地化：命令标题、视图名、设置项说明随语言切换
- `npm run selfcheck:i18n`：校验三份语言包 key 与占位符一致、`package.json` 的 `%key%` 与 nls 文件一一对应
- 启动 / 重启完成后弹出带访问地址的成功提示：单应用启动、重启各提示一条（地址取日志探测到的实际端口与 context-path），整组启动只提示一条汇总；失败路径仍走原有报错提示

### Changed

- 运行期所有文案（输出通道日志、弹窗、输入框、悬浮提示、树节点描述、状态栏）统一走 `src/i18n` 的 `t()`

## 0.1.5

面向插件市场的整理，功能无变化。

### Changed

- `README.md` 改为市场版（中英双语 + 界面截图 + 徽章），开发与自检文档移入 `DEVELOPMENT.md`
- 移除 `package.json` 的 `private` 标记，补齐 `homepage` / `bugs` / `galleryBanner` / `extensionKind` 与关键词
- `@vscode/vsce` 升级到 3.x，`@types/vscode` 固定为 `1.75.0`，与 `engines.vscode` 保持一致
- 精简 `.vscodeignore`，打包产物只保留运行所需文件

### Fixed

- 「未发现可启动应用」提示不再假定仓库名（原先写死为 `mes-parent`）
- 自检脚本不再依赖写死的父 POM artifactId，仓库根可用 `--root` 或 `WEB_BOOT_REPO_ROOT` 指定

## 0.1.4

### Added

- 「释放端口（结束占用进程）...」：识别端口占用者的 PID / 进程名 / 命令行，确认后结束；占用者是本扩展运行的应用时直接停止它

## 0.1.0 – 0.1.3

首个公开版本与随后的功能迭代，包含：

- 应用树、手动分组、整组启动 / 调试 / 停止
- reactor 感知的 `mvn spring-boot:run` 命令（reactor 外自动降级为 `-f`）
- profile 端口与 context-path 解析、启动前端口冲突检测
- 调试运行与启动后自动 attach
- 生成 `launch.json`
- 就绪 / 失败日志解析与按进程树停止
- 运行期监控（`jstat` 堆与 GC、HTTP 探活、Actuator 线程池）
- 「重新加载资源」（`mvn process-resources`）
- JaCoCo 运行时覆盖率（agent 挂载、停止前 dump、exec 合并、HTML/XML 报告）
- 子进程输出按行自动识别 UTF-8 / GBK，修复 Windows 中文日志乱码
