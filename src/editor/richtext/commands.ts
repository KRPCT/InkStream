import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * richtext 文本变换命令（EDIT-05 / RESEARCH Pattern 7 / D-15 / D-16）。
 *
 * 全部经 view.state.changeByRange，多选区安全。Phase 2 为 Source 模式：纯插入/包裹语义，
 * 不解析选区是否已加粗（无 toggle 解析，UI-SPEC）。所有产物均为标准 Markdown 或
 * CommonMark 合法 HTML（U→<u>），物理保存始终是 Markdown（无私有格式，T-02-18）。
 */

/**
 * 用 before/after 包裹每个选区。
 * - 有选区：包住选区，新选区落在被包裹文本上（before 之后、after 之前）。
 * - 无选区：插入 before+after，光标落在两者之间（便于继续输入）。
 */
function wrapSelection(view: EditorView, before: string, after: string): boolean {
  view.dispatch(
    view.state.changeByRange((range) => {
      const insert = before + view.state.doc.sliceString(range.from, range.to) + after;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: range.empty
          ? EditorSelection.cursor(range.from + before.length)
          : EditorSelection.range(range.from + before.length, range.to + before.length),
      };
    }),
  );
  view.focus();
  return true;
}

/** 加粗：`**选区**`（无选区插 `****` 光标居中）。 */
export function toggleBold(view: EditorView): boolean {
  return wrapSelection(view, '**', '**');
}

/** 斜体：`*选区*`（无选区插 `**` 光标居中）。 */
export function toggleItalic(view: EditorView): boolean {
  return wrapSelection(view, '*', '*');
}

/** 下划线：`<u>选区</u>`（D-15 物理 HTML，CommonMark 合法；无选区插空标签光标居中）。 */
export function wrapUnderline(view: EditorView): boolean {
  return wrapSelection(view, '<u>', '</u>');
}

/**
 * 插入链接（D-16）。
 * - 有选区：`[选区](url)`，新选区选中 `url` 占位（直接键入即替换为真实地址）。
 * - 无选区：插入空模板 `[]()`，光标置于首个 `[` 之后（便于先写链接文字）。
 */
export function insertLink(view: EditorView): boolean {
  const URL_PLACEHOLDER = 'url';
  view.dispatch(
    view.state.changeByRange((range) => {
      if (range.empty) {
        const insert = '[]()';
        return {
          changes: { from: range.from, insert },
          range: EditorSelection.cursor(range.from + 1),
        };
      }
      const label = view.state.doc.sliceString(range.from, range.to);
      const insert = `[${label}](${URL_PLACEHOLDER})`;
      // url 占位起点：`[` + label + `](` 之后。
      const urlStart = range.from + 1 + label.length + 2;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(urlStart, urlStart + URL_PLACEHOLDER.length),
      };
    }),
  );
  view.focus();
  return true;
}

/** 仅认 http(s) URL（智能粘贴白名单，T-02-17：纯文本包裹，不执行任意输入）。 */
export function isUrl(text: string): boolean {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/.test(t)) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 智能粘贴（D-16）：剪贴板为 http(s) URL 且当前有选区 → 阻止默认 + 把选区包成 `[选区](粘贴URL)`。
 * 其余情形（无选区 / 非 URL / 无剪贴板数据）放行默认粘贴。
 *
 * 仅处理主选区有选中文本的场景——纯插入式 URL（无选区）交默认粘贴，避免吞掉常规粘贴。
 *
 * 返回值（WR-03）：`true` 表示已处理并 preventDefault（调用方据此 `return true` 阻止 CM
 * 其余 paste handler，含 @codemirror/lang-markdown 内建的较宽松 URL 粘贴——后者会把 `www.`
 * 前缀自动补 https 等，绕过本项目 isUrl 的 http(s) 白名单，故须由本受信处理器优先裁决，T-02-17）。
 * `false` 表示未处理，放行默认粘贴。
 */
export function richtextPasteHandler(event: ClipboardEvent, view: EditorView): boolean {
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!isUrl(text)) return false;
  const range = view.state.selection.main;
  if (range.empty) return false;
  event.preventDefault();
  const url = text.trim();
  view.dispatch(
    view.state.changeByRange((r) => {
      const label = view.state.doc.sliceString(r.from, r.to);
      const insert = `[${label}](${url})`;
      return {
        changes: { from: r.from, to: r.to, insert },
        range: EditorSelection.cursor(r.from + insert.length),
      };
    }),
  );
  return true;
}
