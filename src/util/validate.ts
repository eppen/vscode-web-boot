/**
 * 输入校验的纯函数。
 *
 * 抽出来的原因：主类校验同时被命令流程（src/extension.ts 的输入框）和
 * 参数面板的保存路径使用，而本文件不依赖 vscode，可以直接在自检脚本里跑。
 */

/**
 * Java 全限定类名：`a.b.C`，每段以字母 / `_` / `$` 开头，允许 `$` 内部类。
 * 与启动参数 spring-boot.run.main-class 的取值要求一致。
 */
export function isJavaFqn(value: string): boolean {
  return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(value);
}

/** 端口是否在合法区间（1 - 65535 的整数） */
export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}
