/**
 * 纯路径工具（叶子模块，零依赖）。
 *
 * 库内 tab 用相对 vault 根的路径作 key；库外（非工作区）tab 用绝对路径作 key——绝对路径全局唯一，
 * 切库时不会与库内相对路径撞键。本模块提供两类路径的判定与拆分，统一 `/` 分隔。
 */

/** 统一为 `/` 分隔。 */
export function normalizeSlash(path: string): string {
  return path.replace(/\\/g, '/');
}

/** 是否绝对路径（Windows 盘符 `X:/`、POSIX `/`、UNC `\\`）。库外 tab 的 path 恒为绝对路径。 */
export function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(path) || path.startsWith('/') || path.startsWith('\\\\');
}

/**
 * 去掉 Windows 规范化路径的 `\\?\` / `\\?\UNC\` 长路径（verbatim）前缀，并归一为 `/`。
 *
 * vault.root 由 Rust `canonicalize` 得来，Windows 上是 verbatim 形（`\\?\D:\vault`），而原生文件对话框/
 * 拖拽/argv 给的是干净形（`D:\vault`）。两者直接比较会漏判「库内」→ 把库内文件误当库外（#5 分流）。
 * 统一在此剥前缀，使 relativeWithin 两侧可比。POSIX 路径无此前缀，原样返回。
 */
export function stripVerbatim(path: string): string {
  const s = normalizeSlash(path);
  if (s.startsWith('//?/UNC/')) return '//' + s.slice('//?/UNC/'.length); // UNC 共享：\\?\UNC\srv\share → //srv/share
  if (s.startsWith('//?/')) return s.slice('//?/'.length); // 盘符：\\?\D:\vault → D:/vault
  return s;
}

/** 末段文件名（统一分隔、剥末尾分隔后取最后一段）。 */
export function basename(path: string): string {
  const norm = normalizeSlash(path).replace(/\/+$/, '');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}

/** 父目录（统一 `/`、剥末尾分隔）；无父目录时返回自身。 */
export function parentDir(path: string): string {
  const norm = normalizeSlash(path).replace(/\/+$/, '');
  const i = norm.lastIndexOf('/');
  return i <= 0 ? norm : norm.slice(0, i);
}

/**
 * absPath 是否落在 root 内 → 返回相对路径（统一 `/`）；root 自身或在 root 外返回 null。
 * 两侧均先 stripVerbatim：兼容 vault.root 的 Windows verbatim 形与对话框/拖拽的干净形（修误判库外）。
 */
export function relativeWithin(absPath: string, root: string): string | null {
  const a = stripVerbatim(absPath);
  const r = stripVerbatim(root).replace(/\/+$/, '');
  if (a === r) return null;
  const prefix = `${r}/`;
  return a.startsWith(prefix) ? a.slice(prefix.length) : null;
}
