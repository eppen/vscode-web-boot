/**
 * 调试附加：应用启动完成后 attach 到 JDWP 端口。
 *
 * 用 suspend=n，避免「先 attach 再启动」把整个启动流程卡住；
 * 代价是启动阶段的断点可能错过，这与 tasks.json 里现成的调试方案一致。
 */
import * as vscode from 'vscode';

export async function attachToApp(appId: string, debugPort: number): Promise<boolean> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const config: vscode.DebugConfiguration = {
    type: 'java',
    name: `Web Boot attach ${appId}:${debugPort}`,
    request: 'attach',
    hostName: 'localhost',
    port: debugPort,
    timeout: 30000
  };
  try {
    return await vscode.debug.startDebugging(folder, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showWarningMessage(
      `无法 attach 到 ${appId}（端口 ${debugPort}）：${message}。请确认已安装 Extension Pack for Java。`
    );
    return false;
  }
}
