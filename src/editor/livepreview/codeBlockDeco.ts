import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { CODE_INFO_NODE, FENCED_CODE_NODE } from './nodeNames';

/** 走 blockField 整块渲染的公式 info，不在此装饰（它们不是「可编辑代码块」）。 */
const FORMULA_INFOS: ReadonlySet<string> = new Set(['math', 'latex', 'typst']);

/**
 * 代码块视觉区分（块编辑增强 W1 收尾）：给 info 非 math/latex/typst 的 fenced 围栏块每行加行级装饰——
 * `cm-ink-codeblock` 底纹（与普通正文分隔）+ 首/末行圆角 + 首行 `data-lang` 语言角标（标签式显示）。
 *
 * 行级装饰**不替换文本、不碰可编辑性**——代码块仍是可编辑的语法高亮源码（与 codeLanguages 嵌套高亮叠加）。
 * 公式块（math/latex/typst）由 blockField 整块 replace 渲染，跳过不装饰。viewport-only（仅可视区迭代，性能纪律）。
 */
function buildCodeBlockDeco(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== FENCED_CODE_NODE) return undefined;
        const info = node.node.getChild(CODE_INFO_NODE);
        const lang = info
          ? view.state.doc.sliceString(info.from, info.to).trim().split(/\s+/)[0]
          : '';
        if (FORMULA_INFOS.has(lang)) return false; // 公式块由 blockField 接管，不加代码底纹
        const startLine = view.state.doc.lineAt(node.from).number;
        const endLine = view.state.doc.lineAt(node.to).number;
        for (let ln = startLine; ln <= endLine; ln++) {
          const line = view.state.doc.line(ln);
          const cls =
            'cm-ink-codeblock' +
            (ln === startLine ? ' cm-ink-codeblock-first' : '') +
            (ln === endLine ? ' cm-ink-codeblock-last' : '');
          builder.add(
            line.from,
            line.from,
            ln === startLine && lang
              ? Decoration.line({ class: cls, attributes: { 'data-lang': lang } })
              : Decoration.line({ class: cls }),
          );
        }
        return false; // 不下钻 FencedCode 子树
      },
    });
  }
  return builder.finish();
}

export const codeBlockDeco = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildCodeBlockDeco(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = buildCodeBlockDeco(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** 代码块底纹 + 语言角标样式（永不硬编色，复用 theme.css 在册变量）。 */
export const codeBlockTheme = EditorView.theme({
  '.cm-ink-codeblock': { backgroundColor: 'var(--cm-inline-code-bg)' },
  '.cm-ink-codeblock-first': {
    position: 'relative',
    borderTopLeftRadius: '6px',
    borderTopRightRadius: '6px',
  },
  '.cm-ink-codeblock-last': {
    borderBottomLeftRadius: '6px',
    borderBottomRightRadius: '6px',
  },
  // 语言角标（标签式）：首行右上角小 chip，读 data-lang 属性（CSS attr，无额外 widget）。
  '.cm-ink-codeblock-first::after': {
    content: 'attr(data-lang)',
    position: 'absolute',
    top: '0',
    right: '4px',
    padding: '0 6px',
    fontSize: '0.72em',
    lineHeight: '1.7',
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-muted)',
    backgroundColor: 'var(--background-modifier-border)',
    borderRadius: '0 6px 0 5px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    pointerEvents: 'none',
  },
});
