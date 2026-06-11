import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * 语法高亮样式：@lezer/highlight tag → theme.css 的 --cm-* CSS 变量。
 *
 * 纪律（UI-SPEC §Color A）：
 * - 取色一律走 var(--cm-*)，本文件永不写硬编码色值；新增 token 先进 theme.css。
 * - --cm-* 仅随 data-theme 变（亮暗双套），不吃模式 accent。
 * - strong 加粗一律 600（继承 Phase 1），emphasis 用 italic（中文栈无真斜体时靠色彩区分）。
 *
 * tag→变量映射照 UI-SPEC §Color A 表，一个 --cm-* 可由多个语义相近 tag 复用。
 */
export const inkstreamHighlightStyle = HighlightStyle.define([
  // --cm-keyword：关键字 / 修饰符 / 控制流关键字
  { tag: [t.keyword, t.modifier, t.controlKeyword], color: 'var(--cm-keyword)' },
  // --cm-string：字符串字面量及其特殊形式
  { tag: [t.string, t.special(t.string)], color: 'var(--cm-string)' },
  // --cm-comment：行/块注释
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--cm-comment)' },
  // --cm-number：数字 / 布尔 / atom
  { tag: [t.number, t.bool, t.atom], color: 'var(--cm-number)' },
  // --cm-function：函数名 / 函数属性
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: 'var(--cm-function)',
  },
  // --cm-type：类型名 / 类名 / 命名空间
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--cm-type)' },
  // --cm-variable：变量名 / 属性名
  { tag: [t.variableName, t.propertyName], color: 'var(--cm-variable)' },
  // --cm-operator：运算符 / 标点 / 分隔符
  { tag: [t.operator, t.punctuation, t.separator], color: 'var(--cm-operator)' },
  // --cm-heading：Markdown 标题
  { tag: t.heading, color: 'var(--cm-heading)' },
  // --cm-emphasis：斜体强调
  { tag: t.emphasis, color: 'var(--cm-emphasis)', fontStyle: 'italic' },
  // --cm-strong：加粗强调（字重 600，不 700）
  { tag: t.strong, color: 'var(--cm-strong)', fontWeight: '600' },
  // --cm-link：链接 / URL
  { tag: [t.link, t.url], color: 'var(--cm-link)' },
  // --cm-meta：元信息 / frontmatter 分隔 / YAML key
  { tag: [t.meta, t.processingInstruction], color: 'var(--cm-meta)' },
  // --cm-invalid：未解析 / 非法（@codemirror/lint 未来挂点）
  { tag: t.invalid, color: 'var(--cm-invalid)' },
]);
