import { zoteroCayw } from '../ipc/zotero';
import { useEditorStore } from '../stores/useEditorStore';
import { showToast } from '../stores/useToastStore';
import { languageFromDoc } from './languages';
import { getView } from './viewHandle';

/**
 * 学术写作动作（Phase 8 ZOT / ACAD）。经 getView() 取单内核 EditorView（EditorView 不进 store 纪律）。
 */

function errText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
}

/** 从 pandoc CAYW 结果（`[@k1; @k2]`）抽 citekey。 */
const CITEKEY_RE = /@([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)/gu;

/**
 * 按文档语言重排引用（ZOT-05 引用↔Typst/LaTeX 联动）：
 * markdown/richtext/其它 → pandoc 原样 `[@k]`；typst → `#cite(<k>)`；latex → `\cite{k1,k2}`。
 */
export function formatCitationFor(cayw: string, lang: string): string {
  if (lang !== 'typst' && lang !== 'latex') return cayw;
  const keys = [...cayw.matchAll(CITEKEY_RE)].map((m) => m[1]);
  if (keys.length === 0) return cayw;
  return lang === 'typst'
    ? keys.map((k) => `#cite(<${k}>)`).join(' ')
    : `\\cite{${keys.join(',')}}`;
}

/**
 * 并发守卫：CAYW 是 Zotero 的「文字处理器集成命令」，同时只能跑一个——重复触发会撞
 * 「集成命令已在运行」。pending 期间再调直接忽略 + 提示，杜绝叠加。
 */
let citing = false;

/**
 * 插入引用（ZOT-01）：触发 Zotero CAYW picker，用户选完后把返回的 `[@citekey]` 插入光标处。
 * Zotero 未运行 / BBT 未装 / 超时 → 明确错误 toast。用户取消（空串）→ 静默 no-op。
 * 并发守卫：一次只允许一个 CAYW（Zotero 集成命令串行）。
 */
export async function insertCitation(): Promise<void> {
  const view = getView();
  if (!view) return;
  if (citing) {
    showToast('warning', '引用选择已在进行中——请先在 Zotero 选择器里完成或按 Esc 取消。');
    return;
  }
  citing = true;
  let cite: string;
  try {
    cite = await zoteroCayw();
  } catch (e) {
    showToast('error', `插入引用失败：${errText(e)}`);
    return;
  } finally {
    citing = false;
  }
  if (!cite.trim()) return; // 用户取消
  // ZOT-05：按当前文档语言重排（typst #cite(<k>) / latex \cite{k} / 其余 pandoc [@k]）。
  const path = useEditorStore.getState().activePath ?? '';
  const text = formatCitationFor(cite, languageFromDoc(view.state.doc.toString(), path));
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * 插入脚注（ACAD-02）：光标处插 `[^N]` 引用标记，文末追加 `[^N]: ` 定义并把光标移到定义处。
 * N 取文档内未用的最小正整数。
 */
export function insertFootnote(): void {
  const view = getView();
  if (!view) return;
  const doc = view.state.doc.toString();
  const used = new Set([...doc.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1])));
  let n = 1;
  while (used.has(n)) n += 1;
  const ref = `[^${n}]`;
  const def = `${doc.endsWith('\n') ? '' : '\n'}[^${n}]: `;
  const docLen = view.state.doc.length;
  const { from } = view.state.selection.main;
  view.dispatch({
    changes: [
      { from, insert: ref },
      { from: docLen, insert: def },
    ],
    // 两处插入按原坐标应用；ref 在 from(<docLen) 前插使其后整体右移 ref.length，故定义末尾 = 原 docLen + ref + def。
    selection: { anchor: docLen + ref.length + def.length },
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * 插入参考文献占位（ACAD-02 / ZOT-04 标记）：文末插 `## 参考文献` + `<!-- biblio -->`（编译时展开，后续）。
 * 已存在则提示不重复插。
 */
export function insertBibliography(): void {
  const view = getView();
  if (!view) return;
  const doc = view.state.doc.toString();
  if (doc.includes('<!-- biblio -->')) {
    showToast('warning', '文末已有参考文献占位（<!-- biblio -->）。');
    return;
  }
  const prefix = doc.endsWith('\n\n') ? '' : doc.endsWith('\n') ? '\n' : '\n\n';
  const insert = `${prefix}## 参考文献\n\n<!-- biblio -->\n`;
  const docLen = view.state.doc.length;
  view.dispatch({
    changes: { from: docLen, insert },
    selection: { anchor: docLen + insert.length },
    scrollIntoView: true,
  });
  view.focus();
}
