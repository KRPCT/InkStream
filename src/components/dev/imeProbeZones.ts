import type { Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { syntaxHighlighting } from '@codemirror/language';
import { drawSelection, highlightActiveLine, keymap } from '@codemirror/view';
import { compositionGate } from '../../editor/composition';
import { baseExtensions } from '../../editor/extensions';
import { inkstreamHighlightStyle } from '../../editor/highlightTheme';
import { extensionsForLanguage, langCompartment } from '../../editor/languages';

/**
 * R2「一轮二分定位器」受试区清单（A–H）。
 *
 * 思路：真机中文 IME 在裸 contentEditable（B）正常、在 CM6 完整编辑器（H）失效。病灶必在「裸 div →
 * CM6 完整栈」这条链的某一层。8 区从两端向中间二分，每区只比上一区多挂一层嫌疑物，用户打一轮拼音即可
 * 锁定第一个失效的区——那一层（相对前一区新增的属性/样式/扩展）就是罪魁。
 *
 * 路径对比纪律：CM 区既测「程序化转焦」又测「真实点击」——CDP 合成在 CM6 内管线健康，但真机程序化聚焦
 * 是否武装 TSF 未知，故两条路径都要各打一次拼音留证。
 */

/** 受试区物理类型：原生表单元素 / 裸或仿 contentEditable / throwaway EditorView。 */
export type ZoneKind = 'textarea' | 'div' | 'div-cm-attrs' | 'cm';

export interface ZoneSpec {
  /** 区号字母（A–H），用于标题与稳定的测试定位。 */
  id: string;
  /** 一句话面板标签（含区号）。 */
  label: string;
  /** 一句话假设（区号上方标注，写清这一层在测什么）。 */
  hypothesis: string;
  kind: ZoneKind;
  /** cm 区的 throwaway EditorView 扩展工厂；非 cm 区为 undefined。 */
  extensions?: () => Extension;
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
];
