import { type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * `/` slash 命令补全源（Phase 5 W1 / BLOCK-01：`/math` 插入数学块）。
 *
 * 范式同 wikiLinkComplete.ts（autocompletion override 数组里的一个 source）。但 slash 命令 apply 不是简单
 * 字符串替换：要删掉已键入的 `/math`、插入多行块、把光标精确放进块内空行——故 apply 用函数形态
 * （view, completion, from, to）自行 dispatch。
 *
 * 不抢焦点：apply 仅 dispatch 改 doc + 设 selection；补全 apply 后 CM6 本就保持编辑器焦点（用户在编辑器内键入
 * `/math` 触发），零 view.focus（WebView2 IME 硬约束）。插入后光标落 math 块内空行 → blockField 判「光标进块」
 * 显源码，用户接着键 latex；移出块即渲染（与块还原逻辑自洽）。
 */

interface SlashCommand {
  label: string;
  detail: string;
  apply: (view: EditorView, completion: unknown, from: number, to: number) => void;
}

/** 插入一个 ```<lang> 围栏块，光标落块内空行（head 之后、tail 之前）。 */
function insertFencedBlock(lang: string): SlashCommand['apply'] {
  const head = '```' + lang + '\n';
  const tail = '\n```';
  return (view, _c, from, to) => {
    view.dispatch({
      changes: { from, to, insert: head + tail },
      selection: EditorSelection.cursor(from + head.length),
      scrollIntoView: true,
      userEvent: 'input.complete',
    });
  };
}

const SLASH_COMMANDS: readonly SlashCommand[] = [
  { label: '/math', detail: '数学公式块（KaTeX）', apply: insertFencedBlock('math') },
  { label: '/latex', detail: 'LaTeX 公式块（MathJax）', apply: insertFencedBlock('latex') },
];

/** slash 命令补全源：匹配行首 / 空白后的 `/命令名`（避免 a/b 路径误触发）。 */
export function slashCommandSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/(?:^|\s)\/\w*$/);
  if (!m) return null;
  // matchBefore 命中可能含前导空白：from 修正到真正的 `/` 处。
  const slashIdx = m.text.lastIndexOf('/');
  const from = m.from + slashIdx;
  const typed = m.text.slice(slashIdx); // 含 `/`，如 `/ma`
  const options = SLASH_COMMANDS.filter((c) => c.label.startsWith(typed) || typed === '/').map(
    (c) => ({ label: c.label, detail: c.detail, apply: c.apply }),
  );
  if (options.length === 0) return null;
  return { from, options, filter: false };
}
