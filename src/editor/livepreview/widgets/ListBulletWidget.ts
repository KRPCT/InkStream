import { WidgetType } from '@codemirror/view';

/**
 * 无序列表项目符号 widget（行内层 / D-06 列表逐行还原 / UI-SPEC「列表」）。
 *
 * 职责：把无序列表标记 `-` / `*` / `+`（ListMark 节点，长 1）经 Decoration.replace 换成
 * 真项目符号 `•`——`cm-ink-list-mark` 隐藏底纹方案缺 ::before 时标记整体不可见（看似裸文本丢符号），
 * 改用 widget 直接呈现可见圆点，渲染态稳定可见、缩进保排版。光标进该行由 inlinePlugin 整还原源码
 * （活动行跳过本 widget），`-`/`*`/`+` 原字符可见可编辑（D-06）。
 *
 * 有序列表不走本 widget：其序号 `1.`/`2.` 是有语义的可见文本，渲染态保留数字不替换（见 inlinePlugin）。
 *
 * 无状态：所有无序标记渲染同一 `•`，eq 恒 true（CM6 复用旧 DOM 不重建，防闪烁）。
 * 非交互：ignoreEvent 返回 true，点击该行经光标行还原承接进编辑。
 * 样式经 .cm-ink-bullet class 消费正文色，**永不硬编码色值**（highlightTheme.ts 纪律）。
 */
export class ListBulletWidget extends WidgetType {
  /** 所有无序标记渲染相同 `•`：视为同一 widget，CM6 复用旧 DOM（防闪烁）。 */
  eq(): boolean {
    return true;
  }

  /** 项目符号非交互：吞内部事件，编辑经光标行还原承接（D-06）。 */
  ignoreEvent(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-ink-bullet';
    span.textContent = '•';
    return span;
  }
}
