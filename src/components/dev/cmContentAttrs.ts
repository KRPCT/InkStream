/**
 * CM6 `.cm-content` 默认属性集照抄（R2 二分探针 C 区）。
 *
 * 病灶定位假设：CM6 给 contentEditable 附加的属性/样式与裸 div 的差异，可能让 OS 的 TSF/IME
 * 截走拼音。C 区把 CM6 .cm-content 的全套默认 attributes 与 lineWrapping 关键样式照抄到一个
 * 普通 contentEditable div 上——若 C 区也吞字而 B 区（裸 div）正常，则罪魁在「这些属性/样式」层；
 * 若 C 区仍正常，则罪魁在 CM6 的 DOM 结构 / 事件监听 / observer 层（D-H 区继续二分）。
 *
 * 来源（硬证据，照抄而非臆测）：
 *   node_modules/@codemirror/view/dist/index.js（@codemirror/view@6.43.1）
 *   - updateAttrs() 内 contentAttrs 字面量（行 8219-8230）：
 *       spellcheck:"false" / autocorrect:"off" / autocapitalize:"off" /
 *       writingsuggestions:"false" / translate:"no" / contenteditable:"true"(editable 时) /
 *       class:"cm-content" / style:`tab-size: <n>` / role:"textbox" / aria-multiline:"true"
 *   - EditorView.lineWrapping = contentAttributes.of({class:"cm-lineWrapping"})（行 8926）
 *     baseExtensions 无条件常开 lineWrapping，故 .cm-content 实带 class="cm-content cm-lineWrapping"。
 *   - 基础主题 ".cm-lineWrapping" 规则（行 6800-6805）：
 *       white-space: break-spaces; word-break: break-word; overflow-wrap: anywhere;
 *
 * 注意 autocapitalize：CM6 源用 "off"（非 "none"）；这里照抄源码值，不按 HTML 规范「美化」，
 * 因为本探针的全部价值就是「与 CM6 真实 DOM 逐字节一致」——任何偏差都会污染二分结论。
 */

/**
 * CM6 .cm-content 默认 attributes（照抄 view@6.43.1 updateAttrs，editable + lineWrapping 在册）。
 *
 * 字段名用 React 的 DOM prop 形态（contentEditable / spellCheck / className 等），spread 到 JSX 即生成
 * 与 CM6 逐字节一致的真实 DOM 属性；class 经 className 字段单独承载（避免与 JSX 自带 className 冲突）。
 * 非标准属性（autocorrect/autocapitalize/translate/writingsuggestions）React 原样透传到 DOM。
 */
export const CM_CONTENT_ATTRS = {
  spellCheck: false,
  autoCorrect: 'off',
  autoCapitalize: 'off',
  writingsuggestions: 'false',
  translate: 'no' as const,
  contentEditable: true,
  role: 'textbox',
  'aria-multiline': true,
  // class:"cm-content cm-lineWrapping"——探针不挂 CM 主题，故把 lineWrapping 关键样式直接内联（见下）。
  className: 'cm-content cm-lineWrapping',
} as const;

/**
 * .cm-lineWrapping 的关键内联样式（view@6.43.1 基础主题 ".cm-lineWrapping" 规则照抄）。
 * 探针 C 区不加载 CM 主题 stylesheet，故把决定 IME 行为最相关的 white-space 等直接写进 style。
 * tab-size 照抄源码 style:`tab-size: <n>`（CM 默认 tabSize=4）。
 */
export const CM_CONTENT_STYLE: Record<string, string> = {
  whiteSpace: 'break-spaces',
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
  tabSize: '4',
};
