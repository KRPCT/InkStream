import type { Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { syntaxHighlighting } from '@codemirror/language';
import { drawSelection, EditorView, highlightActiveLine, keymap } from '@codemirror/view';
import { compositionGate } from '../../editor/composition';
import { baseExtensions } from '../../editor/extensions';
import { inkstreamHighlightStyle } from '../../editor/highlightTheme';
import { extensionsForLanguage, langCompartment } from '../../editor/languages';
import {
  installContentEditableFlip,
  installFocusCycle,
  installTextareaRelay,
} from './imeMitigations';

/**
 * IME 探针受试区清单：A–H 二分定位器 + I/J/K 候选解法验证台。
 *
 * 二分（A–H）：真机中文在裸 contentEditable（B）正常、CM6 完整编辑器（H）失效，病灶在「裸 div → CM6
 * 完整栈」某一层。8 区从两端向中间二分，每区只比上一区多挂一层嫌疑物，打一轮拼音锁定第一个失效区。
 * 铁证结论：A–C 正常、D–H（CM6 零扩展起）首次组合被吞、重试恢复——签名=「焦点落定后首次组合被吞，
 * 后续正常」。机理假说=CM6 聚焦/点击时程序化改写 DOM selection，打断 WebView2 TSF 首次组合初始化。
 *
 * 候选解法（I/J/K）：基于上述假说的三种缓解尝试（详见各区 hypothesis 与 imeMitigations.ts）。I/J 在
 * CM6 零扩展上「迫使 TSF 在 selection 改写后重绑」（焦点循环 / contenteditable 翻转）；K 用透明 textarea
 * 覆盖中继 IME 到只读 CM，证明 textarea 中继落子可行。
 *
 * 路径对比纪律：CM 区既测「程序化转焦」又测「真实点击」——CDP 合成在 CM6 内管线健康，但真机程序化聚焦
 * 是否武装 TSF 未知，故两条路径都要各打一次拼音留证。I/J 重点测「点击后首次打拼音是否直接成功」。
 */

/** 受试区物理类型：原生表单元素 / 裸或仿 contentEditable / throwaway EditorView。 */
export type ZoneKind = 'textarea' | 'div' | 'div-cm-attrs' | 'cm';

export interface ZoneSpec {
  /** 区号字母（A–K），用于标题与稳定的测试定位。 */
  id: string;
  /** 一句话面板标签（含区号）。 */
  label: string;
  /** 一句话假设（区号上方标注，写清这一层在测什么）。 */
  hypothesis: string;
  kind: ZoneKind;
  /** cm 区的 throwaway EditorView 扩展工厂；非 cm 区为 undefined。 */
  extensions?: () => Extension;
  /**
   * cm 区的命令式接线钩子（I/J/K 候选解法专用）：EditorView 与受试区容器就绪后调用，挂监听 / textarea
   * 中继等副作用，返回 cleanup（ProbeZone 卸载 throwaway view 前调）。A–H 区为 undefined。
   */
  setup?: (view: EditorView, host: HTMLElement) => () => void;
}

/** D–H 各 CM 区相对前一区只多挂一层嫌疑物（严格递增，保证二分单调）。 */
const ZONE_E_EXTENSIONS = (): Extension => [drawSelection(), highlightActiveLine()];

const ZONE_F_EXTENSIONS = (): Extension => [compositionGate];

const ZONE_G_EXTENSIONS = (): Extension => [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
  search(),
  syntaxHighlighting(inkstreamHighlightStyle),
  langCompartment.of(extensionsForLanguage('markdown')),
];

export const ZONES: ZoneSpec[] = [
  {
    id: 'A',
    label: 'A. <textarea>（基线对照）',
    hypothesis: 'A：原生表单控件，IME 必然正常——基线真值，验证机器/输入法本身无门。',
    kind: 'textarea',
  },
  {
    id: 'B',
    label: 'B. 裸 contentEditable div（基线对照）',
    hypothesis: 'B：最朴素 contentEditable，已实证真机正常——病灶必在它与 CM6 之间的差异。',
    kind: 'div',
  },
  {
    id: 'C',
    label: 'C. 仿 CM6 属性 contentEditable div',
    hypothesis:
      'C：照抄 CM6 .cm-content 全套 attributes + lineWrapping 样式——属性/样式层是否独立致吞字。',
    kind: 'div-cm-attrs',
  },
  {
    id: 'D',
    label: 'D. CM6 零扩展（EditorView 裸态）',
    hypothesis: 'D：new EditorView 无任何扩展——CM6 的 DOM 结构 / DocView / observer 是否独立致吞字。',
    kind: 'cm',
    extensions: () => [],
  },
  {
    id: 'E',
    label: 'E. CM6 + drawSelection + highlightActiveLine',
    hypothesis: 'E：drawSelection 隐藏原生光标、highlightActiveLine 改 DOM——是否阻断 TSF/合成。',
    kind: 'cm',
    extensions: ZONE_E_EXTENSIONS,
  },
  {
    id: 'F',
    label: 'F. CM6 + compositionGate',
    hypothesis: 'F：仅挂组合冻结门（domEventHandlers + transactionExtender）——门本身是否吞字。',
    kind: 'cm',
    extensions: ZONE_F_EXTENSIONS,
  },
  {
    id: 'G',
    label: 'G. CM6 + 常规交互组（history/keymap/search/高亮/markdown）',
    hypothesis: 'G：history+keymap+search+syntaxHighlighting+markdown 键位——交互扩展层是否吞字。',
    kind: 'cm',
    extensions: ZONE_G_EXTENSIONS,
  },
  {
    id: 'H',
    label: 'H. CM6 完整 baseExtensions（含 livePreview 全套）',
    hypothesis: 'H：生产同款 baseExtensions（theme/lineWrapping/livePreview 装饰全套）——复现真吞字。',
    kind: 'cm',
    extensions: () => baseExtensions('markdown'),
  },
  {
    id: 'I',
    label: 'I. CM6 零扩展 + 牺牲性焦点循环',
    hypothesis:
      'I：focus 后微任务做一次 blur→focus，让 TSF 在 CM6 selection 改写后重绑——首次拼音可否直接成功。',
    kind: 'cm',
    extensions: () => [],
    setup: (view) => installFocusCycle(view),
  },
  {
    id: 'J',
    label: 'J. CM6 零扩展 + contenteditable 翻转',
    hypothesis:
      'J：focus 后微任务把 contentEditable false→true（丢焦补 focus），另一种迫使 TSF 重绑——首次拼音可否直接成功。',
    kind: 'cm',
    extensions: () => [],
    setup: (view) => installContentEditableFlip(view),
  },
  {
    id: 'K',
    label: 'K. CM6 只读 + 透明 textarea 中继',
    hypothesis:
      'K：CM editable=false，覆盖透明 textarea 接 IME，input/compositionend 中继落 CM doc——证明 textarea 中继可行。',
    kind: 'cm',
    extensions: () => EditorView.editable.of(false),
    setup: (view, host) => installTextareaRelayOverlay(view, host),
  },
];

/**
 * K 区接线：在受试区容器内铺一个透明 textarea（绝对定位铺满、opacity 0、捕获点击即聚焦自身），
 * 把它的 IME 输入经 installTextareaRelay 中继进只读 CM。返回 cleanup（摘监听 + 移除 textarea）。
 * textarea 由本函数动态创建（非 JSX）——CM 区容器在 ProbeZone 内本就由 useEffect 注入，保持同一纪律。
 */
function installTextareaRelayOverlay(view: EditorView, host: HTMLElement): () => void {
  const textarea = document.createElement('textarea');
  textarea.setAttribute('data-relay-input', '');
  textarea.setAttribute('aria-label', 'K 中继 textarea');
  Object.assign(textarea.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    border: 'none',
    padding: '0',
    background: 'transparent',
    color: 'transparent',
    caretColor: 'transparent',
    opacity: '0',
    resize: 'none',
    outline: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  // host 需为定位上下文，textarea inset:0 才铺满 CM 区。.cm-probe-host 无 CSS 规则，故就地置
  // position:relative（卸载还原），K 区自包含、不碰全局样式表。
  const prevPosition = host.style.position;
  host.style.position = 'relative';
  host.appendChild(textarea);
  const detach = installTextareaRelay(view, textarea);
  return () => {
    detach();
    textarea.remove();
    host.style.position = prevPosition;
  };
}
