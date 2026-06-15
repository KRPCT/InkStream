import { readFile } from '../ipc/files';
import { listDir } from '../ipc/vault';
import { useCodexStore } from '../stores/useCodexStore';
import type { CodexEntry, CodexType } from '../types/creative';
import { isComposing, refreshLivePreview } from './composition';
import { bodyStart, readFields } from './frontmatter';
import { getView } from './viewHandle';

/**
 * Codex 扫描（CREA-02）：固定 `Codex/` 文件夹下带 `type:` frontmatter 的 .md = 条目（决策锁定）。
 * v1 全客户端 readFile per entry（Codex 条目通常数十个，够用）。条目变更经 refreshCodex 重扫 + 刷新活动视图。
 */

export const CODEX_TYPE_LABEL: Record<CodexType, string> = {
  character: '角色',
  location: '地点',
  lore: '设定',
};
const TYPES: readonly CodexType[] = ['character', 'location', 'lore'];
const CODEX_DIR = 'Codex';
const MD = /\.(md|markdown|txt)$/i;

/** 正文首段作悬停卡兜底正文（无 summary 字段时）。 */
function firstParagraph(body: string): string {
  const t = body.trim();
  const end = t.indexOf('\n\n');
  return (end === -1 ? t : t.slice(0, end)).replace(/\s+/g, ' ').trim();
}

async function readEntry(root: string, file: string): Promise<CodexEntry | null> {
  const relPath = `${CODEX_DIR}/${file}`;
  try {
    const doc = await readFile(root, relPath);
    const f = readFields(doc, ['type', 'name', 'aliases', 'summary']);
    const type = TYPES.includes(f.type as CodexType) ? (f.type as CodexType) : null;
    if (!type || !f.name) return null; // 需 type + name 才算有效条目
    const aliases = f.aliases
      ? f.aliases
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const summary = f.summary ?? firstParagraph(doc.slice(bodyStart(doc)));
    return { path: relPath, type, name: f.name, aliases, summary };
  } catch {
    return null;
  }
}

/** 扫 `Codex/` 文件夹 → CodexEntry[]（无该文件夹 / 空 / 全无效 → []）。 */
export async function buildCodex(root: string): Promise<CodexEntry[]> {
  const raw = await listDir(root, CODEX_DIR).catch(() => null);
  if (!raw) return [];
  const files = raw.filter((e) => !e.isDir && MD.test(e.name) && !e.name.startsWith('.'));
  const parsed = await Promise.all(files.map((e) => readEntry(root, e.name)));
  return parsed.filter((e): e is CodexEntry => e !== null);
}

/**
 * 重扫 Codex 并更新 store；非组合期派发一次 refreshLivePreview 让活动视图按新条目重建提及高亮
 * （组合期跳过——下一次重建自然读到新 store，避免打断 IME，铁律）。
 * 触发点：打开/切换 vault（vaultFlow）、CodexPanel 挂载/刷新。
 */
export async function refreshCodex(root: string): Promise<void> {
  const entries = await buildCodex(root);
  useCodexStore.getState().setEntries(entries);
  const v = getView();
  if (v && !isComposing(v)) v.dispatch({ effects: refreshLivePreview.of(null) });
}
