import { zoteroCsl } from '../ipc/zotero';
import { showToast } from '../stores/useToastStore';
import type { CitationStyle, CslItem } from '../types/zotero';
import { extractCitations } from './citations';
import { formatBibliography } from './cslFormat';
import { getView } from './viewHandle';

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

/** 插入空参考文献占位（文末标题 + 标记）。已存在则提示不重复。 */
function insertPlaceholder(): void {
  const view = getView();
  if (!view) return;
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
}

/**
 * 展开/刷新参考文献：扫 `[@key]` → Zotero 取 CSL → 按 style 渲染 → 替换占位区域。
 * styleOverride 缺省时沿用文档已编码样式（无占位则默认 gbt7714）。Zotero 失败 → 错误 toast。
 */
async function expand(styleOverride?: CitationStyle): Promise<void> {
  const view = getView();
  if (!view) return;
  const doc = view.state.doc.toString();
  const style = styleOverride ?? detectBiblioStyle(doc) ?? 'gbt7714';
  const keys = extractCitations(view.state).map((c) => c.key);
  let items: CslItem[];
  try {
    items = keys.length ? await zoteroCsl(keys) : [];
  } catch (e) {
    showToast('error', `展开参考文献失败：${errText(e)}`);
    return;
  }
  const resolved = new Set(items.map((it) => it['citation-key'] ?? it.citekey ?? ''));
  const missing = keys.filter((k) => !resolved.has(k));
  const body = formatBibliography(items, style) || '（暂无可解析的文献）';
  const block = `${marker(style)}\n\n${body}\n\n${END_MARK}`;
  // dispatch 前重读 doc（与上方同步，无异步改动），保证 plan 坐标有效。
  const { from, to, insert } = planBiblioEdit(view.state.doc.toString(), block);
  view.dispatch({ changes: { from, to, insert }, scrollIntoView: true });
  view.focus();
  if (missing.length) {
    showToast('warning', `${missing.length} 条引用在 Zotero 中未找到：${missing.join('、')}`);
  }
}

/**
 * 参考文献命令入口（academic.bibliography）：无占位 → 插入空占位（第一步）；
 * 有占位 → 展开/刷新（第二步）。两步单按钮，符合「Insert Bibliography 后编译展开」。
 */
export async function insertOrExpandBibliography(): Promise<void> {
  const view = getView();
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
