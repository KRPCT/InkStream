import { zoteroCslResilient } from '../ipc/zotero';
import { showToast } from '../stores/useToastStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { CitationStyle, CslItem } from '../types/zotero';
import { extractCitations } from './citations';
import { formatBibliography } from './cslFormat';
import { isBasicEditing } from './documentBudget';
import { applyCommandIntent, captureCommandIntent, getWritableCommandView, runWritableCommand } from './commandView';

/**
 * 参考文献占位与展开（Phase 8 ZOT-04）。占位标记 `<!-- biblio[:style] -->`，
 * 展开后区域夹在 `<!-- biblio:style -->` 与 `<!-- /biblio -->` 之间（幂等可重展）。
 * 样式编码进文档标记（doc 即真相源），不落 app 级设置。
 */

const HEADING = '## 参考文献';
const END_MARK = '<!-- /biblio -->';
/** 匹配 `<!-- biblio -->` 或 `<!-- biblio:apa -->`，捕获样式标识。 */
const BIBLIO_RE = /<!--\s*biblio(?::([a-z0-9]+))?\s*-->/i;
const STYLES = new Set<CitationStyle>(['gbt7714', 'apa', 'vancouver']);
let generation = 0;

function errText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
}

function parseStyle(s: string | undefined): CitationStyle {
  return s && STYLES.has(s as CitationStyle) ? (s as CitationStyle) : 'gbt7714';
}

/** 文档当前参考文献样式（无占位返回 null）。纯函数，可测。 */
export function detectBiblioStyle(doc: string): CitationStyle | null {
  const m = BIBLIO_RE.exec(doc);
  return m ? parseStyle(m[1]) : null;
}

/**
 * 计算把 block 写入文档的最小编辑：有占位 → 替换 [marker, 末标记] 整段；
 * 无占位 → 文末追加「标题 + block」。纯函数，可测（区域数学不依赖 view）。
 */
export function planBiblioEdit(
  doc: string,
  block: string,
): { from: number; to: number; insert: string } {
  const m = BIBLIO_RE.exec(doc);
  if (m) {
    const from = m.index;
    const endIdx = doc.indexOf(END_MARK, from + m[0].length);
    const to = endIdx >= 0 ? endIdx + END_MARK.length : from + m[0].length;
    return { from, to, insert: block };
  }
  const prefix = doc.endsWith('\n\n') ? '' : doc.endsWith('\n') ? '\n' : '\n\n';
  return { from: doc.length, to: doc.length, insert: `${prefix}${HEADING}\n\n${block}\n` };
}

function marker(style: CitationStyle): string {
  return style === 'gbt7714' ? '<!-- biblio -->' : `<!-- biblio:${style} -->`;
}

function currentBlock(doc: string): string | null {
  const found = BIBLIO_RE.exec(doc);
  if (!found) return null;
  const end = doc.indexOf(END_MARK, found.index + found[0].length);
  return doc.slice(found.index, end < 0 ? found.index + found[0].length : end + END_MARK.length);
}

/** Resolve every requested key before replacing a previously complete, correctly numbered block. */
function orderItems(keys: readonly string[], items: readonly CslItem[]): CslItem[] {
  const byKey = new Map<string, CslItem>();
  for (const item of items) {
    const key = item['citation-key'] ?? item.citekey;
    if (!key) continue;
    if (byKey.has(key)) throw new Error(`文献标识「${key}」重复，原参考文献已保留。`);
    byKey.set(key, item);
  }
  const missing = keys.filter((key) => !byKey.has(key));
  if (missing.length) throw new Error(`未找到引用：${missing.join('、')}。原参考文献已保留。`);
  return keys.map((key) => byKey.get(key)!);
}

/** 插入空参考文献占位（文末标题 + 标记）。已存在则提示不重复。 */
function insertPlaceholder(): void {
  runWritableCommand((view) => {
    const doc = view.state.doc.toString();
    if (BIBLIO_RE.test(doc)) {
      showToast('warning', '文末已有参考文献占位（点「展开」可生成条目）。');
      return;
    }
    const prefix = doc.endsWith('\n\n') ? '' : doc.endsWith('\n') ? '\n' : '\n\n';
    const insert = `${prefix}${HEADING}\n\n${marker('gbt7714')}\n`;
    const at = view.state.doc.length;
    view.dispatch({
      changes: { from: at, insert },
      selection: { anchor: at + insert.length },
      scrollIntoView: true,
    });
    view.focus();
  });
}

/**
 * 展开/刷新参考文献：扫 `[@key]` → Zotero 取 CSL → 按 style 渲染 → 替换占位区域。
 * styleOverride 缺省时沿用文档已编码样式（无占位则默认 gbt7714）。Zotero 失败 → 错误 toast。
 */
async function expand(styleOverride?: CitationStyle): Promise<void> {
  const view = getWritableCommandView();
  if (!view) return;
  const intent = captureCommandIntent(view);
  if (isBasicEditing(view.state)) {
    showToast('warning', '请先为此文档启用完整排版，再生成参考文献。');
    return;
  }
  const request = ++generation;
  const path = useEditorStore.getState().activePath;
  const tab = useEditorStore.getState().tabs.find((item) => item.path === path);
  const vault = useVaultStore.getState().vault;
  const doc = view.state.doc.toString();
  const beforeBlock = currentBlock(doc);
  const style = styleOverride ?? detectBiblioStyle(doc) ?? 'gbt7714';
  const keys = extractCitations(view.state).map((c) => c.key);
  const isCurrent = () => request === generation && intent.isCurrent() && getWritableCommandView() === view &&
    useVaultStore.getState().vault === vault && useEditorStore.getState().activePath === path &&
    useEditorStore.getState().tabs.find((item) => item.path === path) === tab;
  let body: string;
  try {
    const items = keys.length ? await zoteroCslResilient(keys) : [];
    if (!isCurrent()) return;
    body = await formatBibliography(orderItems(keys, items), style) || '（暂无引用）';
  } catch (e) {
    if (isCurrent()) showToast('error', `展开参考文献失败：${errText(e)}`);
    return;
  }
  const block = `${marker(style)}\n\n${body}\n\n${END_MARK}`;
  await applyCommandIntent(intent, () => {
    try {
      if (!isCurrent()) return;
      const current = view.state.doc.toString();
      if (isBasicEditing(view.state) || currentBlock(current) !== beforeBlock ||
        JSON.stringify(extractCitations(view.state).map((item) => item.key)) !== JSON.stringify(keys)) {
        showToast('warning', '引用或参考文献在等待期间已改变，请重新生成；当前编辑已保留。');
        return;
      }
      const changes = planBiblioEdit(current, block);
      view.dispatch({ changes, scrollIntoView: true });
    } catch (error) {
      showToast('error', `无法写入参考文献：${errText(error)}`);
    }
  });
}

/**
 * 参考文献命令入口（academic.bibliography）：无占位 → 插入空占位（第一步）；
 * 有占位 → 展开/刷新（第二步）。两步单按钮，符合「Insert Bibliography 后编译展开」。
 */
export async function insertOrExpandBibliography(): Promise<void> {
  const view = getWritableCommandView();
  if (!view) return;
  if (detectBiblioStyle(view.state.doc.toString()) === null) {
    insertPlaceholder();
    return;
  }
  await expand();
}

/** 指定样式展开（工具栏下拉/命令面板）：无占位也会就地生成「标题 + 条目」。 */
export function expandBibliographyAs(style: CitationStyle): Promise<void> {
  return expand(style);
}
