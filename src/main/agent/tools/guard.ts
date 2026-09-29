import fs from 'fs';
import os from 'os';
import path from 'path';

// 工具护栏策略层：零 Electron 依赖，便于在 vitest 中直接测试。
// 策略说明见 docs/specs/tool-safety-guard.md

/** 工具返回值送入上下文前的最大字符数 */
export const MAX_TOOL_OUTPUT_CHARS = 8_000;

/** 单文件读取的最大字节数 */
export const MAX_READ_BYTES = 256 * 1024;

export const DEFAULT_SHELL_TIMEOUT_MS = 30_000;
export const MAX_SHELL_TIMEOUT_MS = 120_000;

export interface SandboxRoots {
  /** 允许读取的根目录 */
  read: string[];
  /** 允许写入的根目录 */
  write: string[];
}

// 显式注入的沙箱根目录（由 main.ts 在 app ready 后按 app.getPath 计算并注入）
let configured: SandboxRoots | null = null;

export function configureSandboxRoots(roots: SandboxRoots): void {
  configured = { read: normalizeList(roots.read), write: normalizeList(roots.write) };
}

export function resetSandboxRoots(): void {
  configured = null;
}

/** 默认沙箱：仅用户主目录。Electron 侧的 documents/desktop 等由 main.ts 追加。 */
export function getSandboxRoots(): SandboxRoots {
  if (configured) return configured;
  let home: string;
  try {
    home = normalizePath(os.homedir());
  } catch {
    // os 模块不可用时 fail-closed：谁也别访问，等调用方显式注入目录
    return { read: [], write: [] };
  }
  return { read: [home], write: [home] };
}

function normalizePath(p: string): string {
  return path.resolve(p).replace(/[\\/]+$/, '');
}

function normalizeList(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const abs = normalizePath(raw.trim());
    const key = process.platform === 'win32' ? abs.toLowerCase() : abs;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(abs);
  }
  return out;
}

/** child 是否位于 parent 之内（含自身） */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

const SENSITIVE_SEGMENTS = new Set([
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.kube',
  '.docker',
  '.password-store',
  '.keyring',
  'credentials',
  'credential',
]);

const SENSITIVE_FILE = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|pfx|key|p12|jks|keystore|kdbx)|\.npmrc|\.pypirc|\.netrc|\.pgpass|\.env(?:\..+)?)$/i;

const ENV_TEMPLATE = /^\.env\.(?:example|sample|template|local\.example)$/i;

function findSensitiveReason(target: string): string | null {
  const parts = target.split(/[\\/]/).filter(Boolean);
  for (const part of parts) {
    if (SENSITIVE_SEGMENTS.has(part.toLowerCase())) {
      return `路径命中敏感目录（${part}）`;
    }
  }
  const base = parts[parts.length - 1] ?? '';
  if (ENV_TEMPLATE.test(base)) return null;
  if (SENSITIVE_FILE.test(base)) {
    return `路径命中敏感凭据文件（${base}）`;
  }
  return null;
}

function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** 沿路径向上找到最深的存在节点，返回其真实路径与尚未创建的尾段 */
function deepestExistingReal(target: string): { real: string; rest: string[] } | null {
  const missing: string[] = [];
  let cursor = target;
  for (;;) {
    const real = realpathOrNull(cursor);
    if (real) return { real: normalizePath(real), rest: missing };
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
}

export type PathCheck = { ok: true; abs: string } | { ok: false; reason: string };

/**
 * 校验路径是否可以读写。写入需要落在 write roots，读取需要落在 read roots。
 * 同时处理 `..` 穿越、符号链接逃逸与敏感凭据路径。
 */
export function checkPath(input: unknown, mode: 'read' | 'write'): PathCheck {
  const raw = typeof input === 'string' ? input : String(input ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: '缺少 path 参数' };
  if (trimmed.includes('\0')) return { ok: false, reason: '路径含非法字符' };
  if (!path.isAbsolute(trimmed)) return { ok: false, reason: '路径必须是绝对路径' };

  const abs = normalizePath(path.resolve(trimmed));
  const roots = mode === 'write' ? getSandboxRoots().write : getSandboxRoots().read;
  const root = roots.find((r) => isInside(r, abs));
  if (!root) {
    const scope = roots.length > 0 ? roots.join('、') : '（未配置）';
    return { ok: false, reason: `路径不在允许目录内，仅允许访问 ${scope}` };
  }

  const scopedReason = findSensitiveReason(abs);
  if (scopedReason) return { ok: false, reason: scopedReason };

  const info = deepestExistingReal(abs);
  if (info) {
    if (!isInside(root, info.real)) {
      return { ok: false, reason: '路径含指向允许范围之外的符号链接' };
    }
    const realReason = findSensitiveReason(info.real);
    if (realReason) return { ok: false, reason: realReason };
    if (info.rest.length === 0) return { ok: true, abs: info.real };
    const joined = path.join(info.real, ...info.rest);
    const joinedReason = findSensitiveReason(joined);
    if (joinedReason) return { ok: false, reason: joinedReason };
    return { ok: true, abs: joined };
  }

  return { ok: true, abs };
}

export interface BlockRule {
  re: RegExp;
  reason: string;
}

/** shell 硬黑名单。命中即拒绝执行，不弹确认框。 */
export const COMMAND_BLOCK_RULES: BlockRule[] = [
  { re: /\brm\s+[^\n]*?(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--force)/, reason: '递归或强制删除文件' },
  { re: /\b(?:del|erase)\s+(?:\/[a-z]+\s+)*\/(?:f|s|q)\b/, reason: '强制或递归删除文件' },
  { re: /\b(?:rd|rmdir)\s+(?:\/[a-z]+\s+)*\/s\b/, reason: '递归删除目录' },
  { re: /\bremove-item\b[^\n]*-(?:r|recurse)\b/, reason: '递归删除目录' },
  { re: /\b(?:format|mkfs|diskpart|fdisk|sgdisk)\b/, reason: '磁盘分区或格式化操作' },
  { re: /\b(?:shutdown|reboot|halt|poweroff|logoff)\b/, reason: '关机或注销操作' },
  { re: /\binit\s+0\b/, reason: '切换系统运行级别' },
  { re: /\b(?:sudo|doas|runas)\b/, reason: '提权执行' },
  { re: /\bsu\s+-\b/, reason: '切换到其他用户身份' },
  { re: /\bchmod\s+(?:-[a-z]*r\s+)?(?:777|a\+rwx)\b/, reason: '放开全部文件权限' },
  { re: /\bchown\s+(?:-[a-z]*r|--recursive)\b/, reason: '递归变更文件属主' },
  { re: /\bicacls\b[^\n]*\/(?:grant|deny|reset|remove)\b/, reason: '修改文件 ACL' },
  { re: /\breg\s+(?:delete|add)\b/, reason: '修改注册表' },
  { re: /\b(?:taskkill|tskill)\b/, reason: '结束进程' },
  { re: /\bkill\s+(?:-9|-kill)\b/, reason: '强制结束进程' },
  { re: /\bstop-process\b/, reason: '结束进程' },
  { re: /\bdd\s+if=/, reason: '裸磁盘读写' },
  { re: /:\s*\(\s*\)\s*\{/, reason: 'fork 炸弹' },
  { re: /\b(?:iex|invoke-expression)\b/, reason: '动态执行脚本字符串' },
  {
    re: /\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n]*\|\s*(?:ba|z|k|fi)?sh\b|\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n]*\|\s*(?:cmd|cmd\.exe|powershell|pwsh)\b/,
    reason: '下载后立即交给解释器执行',
  },
  { re: /\bgit\s+(?:clean\s+-[a-z]*f|reset\s+--hard|push\s+(?:-f|--force)|checkout\s+\.)/, reason: '丢弃本地 Git 改动或强推' },
];

export interface CommandCheck { ok: boolean; reason?: string; }

/** 校验 shell 命令是否允许执行（未通过 = 硬拦截） */
export function inspectCommand(command: unknown): CommandCheck {
  const raw = typeof command === 'string' ? command : String(command ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: '缺少 command 参数' };
  if (trimmed.includes('\0')) return { ok: false, reason: '命令含非法字符' };
  if (trimmed.length > 4_000) return { ok: false, reason: '命令过长' };

  const flat = trimmed.toLowerCase().replace(/\s+/g, ' ');
  for (const rule of COMMAND_BLOCK_RULES) {
    if (rule.re.test(flat)) {
      return { ok: false, reason: `命令命中安全黑名单：${rule.reason}` };
    }
  }
  return { ok: true };
}

/** shell 命令的工作目录：取第一个可写沙箱根 */
export function shellWorkingDirectory(): string | undefined {
  return getSandboxRoots().write[0];
}

/** 把工具返回值压到上下文可接受的长度 */
export function truncateOutput(text: string, max: number = MAX_TOOL_OUTPUT_CHARS): string {
  const value = typeof text === 'string' ? text : String(text ?? '');
  if (value.length <= max) return value;
  const omitted = value.length - max;
  return `${value.slice(0, max)}\n…（输出过长，已省略 ${omitted} 字符）`;
}

/** 归一化 shell 超时，防止工具传超大值让主进程挂住 */
export function clampTimeout(
  value: unknown,
  fallback: number = DEFAULT_SHELL_TIMEOUT_MS,
  max: number = MAX_SHELL_TIMEOUT_MS,
): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}
