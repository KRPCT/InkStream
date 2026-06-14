import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { BLOCK_MATH_CONTENT, BLOCK_MATH_NODE, CODE_TEXT_NODE, FENCED_CODE_NODE } from './nodeNames';
import { clearFormulaEdit } from './formulaEditState';
import { type FormulaEngine, renderPreview } from './formulaPreview';

/**
 * 公式块双栏编辑面板生命周期（块编辑增强 W3）。源码栏用原生 `<textarea>`（IME 原生健壮，真实点击落焦即武装，
 * 无 WebView2 程序化焦点坑），实时写回主 doc 的 CodeText 区间（保 state.doc.toString() 单内核真相源），预览栏
 * 随源码重渲（math/latex 同步、typst 经 typstClient 200ms 防抖）。组合期（中文 IME）只在 compositionend 写回 +
 * 渲染，避免拼音半成品写主 doc / 渲成乱公式。面板实例存模块级 WeakMap，destroy 与挂载配对（StrictMode 纪律）。
 */

interface ActiveFormula {
  readonly textarea: HTMLTextAreaElement;
  readonly preview: HTMLElement;
  readonly blockFrom: number;
  readonly engine: FormulaEngine;
  composing: boolean;
}

const active = new WeakMap<EditorView, ActiveFormula>();
const wrapOwners = new WeakMap<HTMLElement, EditorView>();

export interface FormulaEditInfo {
  readonly info: FormulaEngine;
  readonly source: string;
  readonly blockFrom: number;
}

export function registerFormulaWrap(wrap: HTMLElement, main: EditorView): void {
  wrapOwners.set(wrap, main);
}

export function destroyFormulaEditor(wrap: HTMLElement): void {
  const main = wrapOwners.get(wrap);
  if (!main) return;
  wrapOwners.delete(wrap);
  const a = active.get(main);
  if (a && wrap.contains(a.textarea)) active.delete(main);
}

/** 幂等挂载：已是同块 → 仅刷新预览（保 textarea caret/组合）；否则重建头部 + textarea + 预览。 */
export function mountFormulaEditor(main: EditorView, wrap: HTMLElement, w: FormulaEditInfo): void {
  const existing = active.get(main);
  if (existing && existing.blockFrom === w.blockFrom && wrap.contains(existing.textarea)) {
    renderPreview(main, existing.engine, existing.preview, existing.textarea.value, w.blockFrom);
    return; // 复用：不重建，保用户编辑中的 textarea。
  }
  wrap.replaceChildren();
  buildHeader(wrap, main, w.info);

  const body = document.createElement('div');
  body.className = 'cm-ink-formula-edit-body';
  const textarea = document.createElement('textarea');
  textarea.className = 'cm-ink-formula-edit-src';
  textarea.value = w.source;
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', '公式源码');
  const preview = document.createElement('div');
  preview.className = 'cm-ink-formula-edit-preview';
  body.append(textarea, preview);
  wrap.appendChild(body);

  const a: ActiveFormula = { textarea, preview, blockFrom: w.blockFrom, engine: w.info, composing: false };
  active.set(main, a);

  // textarea 事件不冒泡到主 CM contentDOM（防主编辑器误读为自身输入）。
  for (const t of ['input', 'beforeinput', 'keydown', 'keyup', 'compositionstart', 'compositionend']) {
    textarea.addEventListener(t, (e) => e.stopPropagation());
  }
  textarea.addEventListener('compositionstart', () => {
    a.composing = true;
  });
  textarea.addEventListener('compositionend', () => {
    a.composing = false;
    sync(main, a);
  });
  textarea.addEventListener('input', () => {
    if (!a.composing) sync(main, a); // 组合期不写回（拼音半成品不进主 doc/不渲染），compositionend 统一同步
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      exitEdit(main);
    }
  });

  renderPreview(main, w.info, preview, w.source, w.blockFrom);
  // 真实点击「编辑」按钮的同步链内补焦点（textarea 原生 form 控件，focus 即武装 IME，无 WebView2 坑）。
  queueMicrotask(() => {
    if (textarea.isConnected) textarea.focus();
  });
}

/** 头部：引擎名标签 + 「完成」按钮（点 → 退出双栏）。 */
function buildHeader(wrap: HTMLElement, main: EditorView, engine: FormulaEngine): void {
  const header = document.createElement('div');
  header.className = 'cm-ink-formula-edit-header';
  const label = document.createElement('span');
  label.textContent = { math: 'Math（KaTeX）', latex: 'LaTeX（MathJax）', typst: 'Typst' }[engine];
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'cm-ink-formula-edit-done';
  done.textContent = '完成';
  done.addEventListener('mousedown', (e) => e.preventDefault());
  done.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    exitEdit(main);
  });
  header.append(label, done);
  wrap.appendChild(header);
}

/** 写回主 doc 的 CodeText 区间（每次从 live 语法树重解析，防陈旧）+ 刷新预览。 */
function sync(main: EditorView, a: ActiveFormula): void {
  const range = codeRangeOf(main, a.blockFrom);
  if (range && range.to <= main.state.doc.length) {
    const insert = a.textarea.value;
    if (insert !== main.state.doc.sliceString(range.from, range.to)) {
      main.dispatch({ changes: { from: range.from, to: range.to, insert }, userEvent: 'input.formula.src' });
    }
  }
  renderPreview(main, a.engine, a.preview, a.textarea.value, a.blockFrom);
}

/** 从 live 语法树解析本块 CodeText 区间（空块兜底为围栏首行换行后的插入点）。 */
function codeRangeOf(main: EditorView, blockFrom: number): { from: number; to: number } | null {
  const node = syntaxTree(main.state).resolveInner(blockFrom, 1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === FENCED_CODE_NODE) {
      const ct = n.node.getChild(CODE_TEXT_NODE);
      const line = main.state.doc.lineAt(n.from);
      return ct ? { from: ct.from, to: ct.to } : { from: line.to + 1, to: line.to + 1 };
    }
    if (n.name === BLOCK_MATH_NODE) {
      const ct = n.node.getChild(BLOCK_MATH_CONTENT);
      return ct ? { from: ct.from, to: ct.to } : { from: n.from + 2, to: n.from + 2 };
    }
  }
  return null;
}

/** 退出双栏 → 清编辑态 → blockField 重建 → 该块回落就地渲染（主 doc 已是最新源，回填天然正确）。 */
function exitEdit(main: EditorView): void {
  main.dispatch({ effects: clearFormulaEdit.of(null) });
  main.focus(); // 用户点「完成」/Esc 的真实手势链，IME 不受影响
}
