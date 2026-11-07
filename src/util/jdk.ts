/**
 * JDK 工具定位与命令执行。
 *
 * 监控（jps / jstat）、覆盖率（java / jacococli）都需要「优先用启动进程时的同一个 JDK」：
 * 先看 webBoot.javaHome，再看环境变量 JAVA_HOME，都没有才交给 PATH。
 * 之所以不直接用 PATH：机器上常同时装了 JRE 与多套 JDK，PATH 里的未必带这些工具。
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { t } from '../i18n';

/** 默认命令超时（毫秒） */
export const JDK_CMD_TIMEOUT_MS = 4000;

/** 可执行文件扩展名（Windows 下 jps -> jps.exe） */
function exeName(name: string): string {
  return process.platform === 'win32' && !name.toLowerCase().endsWith('.exe')
    ? `${name}.exe`
    : name;
}

/**
 * 定位 JDK 工具：javaHome/bin/<name> -> $JAVA_HOME/bin/<name> -> 原样交回 PATH。
 * name 允许是 'java' / 'jps' / 'jstat' 等；也兼容直接传入带路径的可执行文件。
 */
export function resolveJdkTool(javaHome: string, name: string): string {
  if (name.includes('/') || name.includes('\\')) {
    return name;
  }
  const exe = exeName(name);
  const candidates: string[] = [];
  const trimmed = javaHome.trim();
  if (trimmed) {
    candidates.push(path.join(trimmed, 'bin', exe));
  }
  const envHome = process.env.JAVA_HOME?.trim();
  if (envHome) {
    candidates.push(path.join(envHome, 'bin', exe));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // 忽略无权限等异常，继续尝试下一个
    }
  }
  return name;
}

/** 执行命令并返回 stdout（失败时 reject，附带 stderr 便于排错） */
export function execText(
  file: string,
  args: string[],
  timeout = JDK_CMD_TIMEOUT_MS,
  cwd?: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, cwd },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || '').toString().trim();
          if (detail && !err.message.includes(detail)) {
            reject(new Error(`${err.message}：${firstLines(detail)}`));
            return;
          }
          reject(err);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

/** 截取多行输出的前几行，避免把整段 Maven 日志塞进 tooltip */
export function firstLines(text: string, maxLines = 3, maxChars = 400): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, maxLines);
  const joined = lines.join(' | ');
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}…` : joined;
}

/** 把未知异常转成可读文案；ENOENT 提示更具体 */
export function friendlyError(err: unknown, toolHint = 'java'): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return t('error.toolNotFound', toolHint);
    }
    return err.message;
  }
  return String(err);
}
