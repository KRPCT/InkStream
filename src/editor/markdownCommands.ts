import { EditorSelection, Prec, type ChangeSpec, type Extension } from '@codemirror/state';
import { keymap, type Command, type EditorView } from '@codemirror/view';
import { useEditorStore } from '../stores/useEditorStore';
import { insertLink, wrapSelection } from './richtext/commands';
import { getView } from './viewHandle';

/**
 * Markdown「编辑/段落/格式」命令（R4 §1.3 段落▸/格式▸ + §3 键位裁决）。
 *
 * 行内格式复用 richtext/commands 的 wrapSelection（产物皆合法 Markdown，无私有格式）。
 * 段落/块级命令逐行改写行首前缀。全部经 view.dispatch 的纯文本变换——不触 setState/
 * reconfigure/磁盘写，与组合冻结门正交（铁律 2 不适用：非组合期破坏性换装）。
 *
 * 这些是 CM6 Command（返回 boolean）：菜单经 builtins 的 getView() 派发，键位经
 * markdownEditKeymap 在 markdown/richtext 文档的 langCompartment 内分发（编辑器聚焦时）。
 */

// ---- 行内格式（格式▸ / Ctrl+B/I 等）----

export const bold: Command = (view) => wrapSelection(view, '**', '**');
export const italic: Command = (view) => wrapSelection(view, '*', '*');
export const inlineCode: Command = (view) => wrapSelection(view, '`', '`');
export const strikethrough: Command = (view) => wrapSelection(view, '~~', '~~');
export const highlight: Command = (view) => wrapSelection(view, '==', '==');

/** 清除选区两侧成对的常见 Markdown 行内标记（`**`/`*`/`` ` ``/`~~`/`==`）。 */
export const clearFormat: Command = (view) => {
  const marks = ['**', '~~', '==', '`', '*'];
  view.dispatch(
    view.state.changeByRange((range) => {
      if (range.empty) return { range };
      let from = range.from;
      let to = range.to;
      const doc = view.state.doc;
      for (const m of marks) {
        if (doc.sliceString(from - m.length, from) === m && doc.sliceString(to, to + m.length) === m) {
          from -= m.length;
          to += m.length;
          const inner = doc.sliceString(from + m.length, to - m.length);
          return {
            changes: { from, to, insert: inner },
            range: EditorSelection.range(from, from + inner.length),
          };
        }
      }
      return { range };
    }),
  );
  view.focus();
  return true;
};

// ---- 块级 / 段落（段落▸）----

/** 当前选区覆盖的行号区间（含端点）。 */
function selectedLines(view: EditorView): { from: number; to: number } {
  const { from, to } = view.state.selection.main;
  return {
    from: view.state.doc.lineAt(from).number,
    to: view.state.doc.lineAt(to).number,
  };
}

/** 对选区覆盖的每一行行首施加 transform；单次 dispatch，改写后整块重新选中。 */
function eachLine(view: EditorView, transform: (text: string, index: number) => string): boolean {
  const { from, to } = selectedLines(view);
  const changes: ChangeSpec[] = [];
  for (let n = from; n <= to; n += 1) {
    const line = view.state.doc.line(n);
    const next = transform(line.text, n - from);
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
  }
  if (changes.length === 0) {
    view.focus();
    return true;
  }
  const tr = view.state.update({ changes });
  // 改写后第一/末行的新边界：经 changes 映射首行行首与末行原行尾。
  const startPos = tr.changes.mapPos(view.state.doc.line(from).from, -1);
  const endPos = tr.changes.mapPos(view.state.doc.line(to).to, 1);
  view.dispatch(tr);
  view.dispatch({ selection: EditorSelection.range(startPos, endPos) });
  view.focus();
  return true;
}

/** 去掉已有 ATX 标题/引用/列表前缀，得到纯正文。 */
function stripBlockPrefix(text: string): string {
  return text.replace(/^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/, '$1');
}

/** 设标题级别（1–6）：先清块前缀再加 `#…# `。 */
export function setHeading(level: number): Command {
  const prefix = `${'#'.repeat(level)} `;
  return (view) => eachLine(view, (t) => prefix + stripBlockPrefix(t).trimStart());
}

/** 正文：清除标题/引用/列表前缀。 */
export const paragraph: Command = (view) => eachLine(view, (t) => stripBlockPrefix(t));

export const bulletList: Command = (view) => eachLine(view, (t) => `- ${stripBlockPrefix(t).trimStart()}`);
export const taskList: Command = (view) => eachLine(view, (t) => `- [ ] ${stripBlockPrefix(t).trimStart()}`);
export const quote: Command = (view) => eachLine(view, (t) => `> ${stripBlockPrefix(t).trimStart()}`);

/** 有序列表：逐行编号（块内从 1 起，index 为块内偏移）。 */
export const orderedList: Command = (view) =>
  eachLine(view, (t, index) => `${index + 1}. ${stripBlockPrefix(t).trimStart()}`);

/** 在光标处插入围栏代码块（光标落在围栏内空行）。 */
export const codeFence: Command = (view) => {
  view.dispatch(
    view.state.changeByRange((range) => {
      const insert = '```\n\n```';
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + 4),
      };
    }),
  );
  view.focus();
  return true;
};

/** 在光标处插入数学块（`$$…$$`，光标落在中间空行）。 */
export const mathBlock: Command = (view) => {
  view.dispatch(
    view.state.changeByRange((range) => {
      const insert = '$$\n\n$$';
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + 3),
      };
    }),
  );
  view.focus();
  return true;
};

/** 插入 2×2 占位表格（GFM 管线表）。 */
export const table: Command = (view) => {
  const tpl = '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n';
  view.dispatch(
    view.state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: tpl },
      range: EditorSelection.cursor(range.from + 2),
    })),
  );
  view.focus();
  return true;
};

/** 插入图片占位（`![]()`，光标落在 `![` 之后写 alt 文本）。 */
export const insertImage: Command = (view) => {
  view.dispatch(
    view.state.changeByRange((range) => {
      const label = view.state.doc.sliceString(range.from, range.to);
      const insert = `![${label}]()`;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + 2 + label.length),
      };
    }),
  );
  view.focus();
  return true;
};

/** 链接命令复用 richtext/insertLink（`[选区](url)`，产物一致，避免重复变换逻辑）。 */
export const link: Command = (view) => insertLink(view);

/**
 * 当前活动文档是否为 markdown 家族（markdown / richtext）。
 *
 * 判据：useEditorStore.activeRenderMode——markdown/richtext 文档为 'source'|'live'，
 * 非 markdown 文档为 null（store 契约，D-01）。段落▸/格式▸ 菜单据此 disabled，且
 * 菜单派发前再校验，避免对 .py/.rs 等代码文档写 Markdown 标记。
 */
export function isMarkdownFamily(): boolean {
  return useEditorStore.getState().activeRenderMode !== null;
}

/**
 * 菜单派发 markdown 命令（builtins 的 para/fmt run 调用）：取单内核 view，
 * 仅 markdown 家族文档执行（非 markdown / 无 view 静默 no-op）。
 */
export function runMarkdownCommand(cmd: Command): void {
  const view = getView();
  if (view && isMarkdownFamily()) cmd(view);
}

/**
 * Markdown 文档键位（R4 §3 裁决，注入 markdown 文档的 langCompartment——仅 markdown 文档 +
 * 编辑器聚焦时分发；非 markdown / 失焦由 window 级 keymap 兜底）。
 *
 * Ctrl+B=加粗（写作应用最强惯例，侧栏已让位 Ctrl+\）；Ctrl+E 不在此（保留切渲染模式，
 * 行内代码改 Ctrl+Shift+`，避免冲突，R4 §1.3 注）。Prec.highest 抢在 defaultKeymap 前。
 *
 * 注：UAT 待用户确认（R4 §3 键位裁决为建议，用户可后续否决）。
 */
export function markdownEditKeymap(): Extension {
  return Prec.highest(
    keymap.of([
      { key: 'Ctrl-b', run: bold, preventDefault: true },
      { key: 'Ctrl-i', run: italic, preventDefault: true },
      { key: 'Ctrl-Shift-`', run: inlineCode, preventDefault: true },
      { key: 'Alt-Shift-5', run: strikethrough, preventDefault: true },
      { key: 'Ctrl-Shift-h', run: highlight, preventDefault: true },
      { key: 'Ctrl-k', run: link, preventDefault: true },
      { key: 'Ctrl-Shift-i', run: insertImage, preventDefault: true },
      { key: 'Ctrl-1', run: setHeading(1), preventDefault: true },
      { key: 'Ctrl-2', run: setHeading(2), preventDefault: true },
      { key: 'Ctrl-3', run: setHeading(3), preventDefault: true },
      { key: 'Ctrl-4', run: setHeading(4), preventDefault: true },
      { key: 'Ctrl-5', run: setHeading(5), preventDefault: true },
      { key: 'Ctrl-6', run: setHeading(6), preventDefault: true },
      { key: 'Ctrl-0', run: paragraph, preventDefault: true },
      { key: 'Ctrl-Shift-8', run: bulletList, preventDefault: true },
      { key: 'Ctrl-Shift-7', run: orderedList, preventDefault: true },
      { key: 'Ctrl-Shift-q', run: quote, preventDefault: true },
      { key: 'Ctrl-t', run: table, preventDefault: true },
      { key: 'Ctrl-Shift-k', run: codeFence, preventDefault: true },
      { key: 'Ctrl-Shift-m', run: mathBlock, preventDefault: true },
    ]),
  );
}
