import type { FileEntry } from '../../types/vault';

/**
 * wiki-link target 解析纯逻辑（Phase 4 W3 跳转 / 后续 W2' 抽链共用）。
 *
 * target 内核形如 `path#heading^block`（`#heading` / `^block` 可选）。本模块只管「路径部分 → vault 文件」
 * 的解析与建链路径计算，不碰 EditorView / store（便于穷举单测）。分隔一律归一为 '/'（字符串方法，不用正则）。
 */

/** 分隔归一为 '/'（避免正则字面量）。 */
function toSlash(s: string): string {
  return s.split('\\').join('/');
}

/** 剥离 `#heading` / `^block`，取 target 的纯路径部分（去首尾空格）。 */
export function wikiTargetPath(raw: string): string {
  let path = raw;
  const hash = path.indexOf('#');
  if (hash >= 0) path = path.slice(0, hash);
  const caret = path.indexOf('^');
  if (caret >= 0) path = path.slice(0, caret);
  return path.trim();
}

/**
 * 把 target 路径解析为 vault 内文件的相对路径；解析不到返回 null。
 *
 * 顺序（Obsidian 风）：① 精确相对路径（`target` 或补 `.md`）；② 文件名匹配（末段去 `.md`，支持裸名
 * `[[NoteName]]`，多个同名取首个）。中文按原样比较（NFC 一致性由上游保证）。
 */
export function resolveWikiTarget(targetPath: string, files: readonly FileEntry[]): string | null {
  const t = toSlash(targetPath).trim();
  if (!t) return null;
  const withMd = t.endsWith('.md') ? t : `${t}.md`;
  for (const f of files) {
    const p = toSlash(f.path);
    if (p === withMd || p === t) return f.path;
  }
  const base = t.split('/').pop() ?? t;
  const baseNoMd = base.endsWith('.md') ? base.slice(0, -3) : base;
  for (const f of files) {
    const nameNoMd = f.name.endsWith('.md') ? f.name.slice(0, -3) : f.name;
    if (nameNoMd === baseNoMd) return f.path;
  }
  return null;
}

/** target 路径 → 建链相对路径（补 `.md`）。目标不存在时据此 createFile。 */
export function wikiTargetToCreatePath(targetPath: string): string {
  const t = toSlash(targetPath).trim();
  return t.endsWith('.md') ? t : `${t}.md`;
}
