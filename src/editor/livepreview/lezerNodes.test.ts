import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { extensionsForLanguage } from '../languages';

/**
 * GFM 节点存在性 + `<u>` 配对结构 dump（EDIT-03 / RESEARCH A2）。
 *
 * 目的：
 *   1. 固化「markdown({ extensions: [GFM] }) 接入后 Table / Task / Strikethrough 节点确实解析」
 *      —— 这是 SC「GFM 接入」的回归门；GFM 一旦掉链，本测试先红。
 *   2. dump `<u>text</u>` 在 GFM markdown 下的实际 syntaxTree 节点序列（A2）。
 *      RESEARCH 推测 `<u>` 解析为开/闭 HTMLTag + 中间纯文本、不成对包裹，置信 MEDIUM；
 *      本测试在执行期固化真实结构，Wave 1 inlinePlugin 的下划线配对逻辑据此实现。
 */

/** 用 markdown(GFM) 扩展构建 state 并收集 syntaxTree 全部节点名集合。 */
function collectNodeNames(doc: string): Set<string> {
  const state = EditorState.create({
    doc,
    extensions: [extensionsForLanguage('markdown')],
  });
  const names = new Set<string>();
  syntaxTree(state).iterate({
    enter: (node) => {
      names.add(node.name);
    },
  });
  return names;
}

/** dump 某段文本的 (节点名 @ from-to) 序列，供结构快照。 */
function dumpNodes(doc: string): string {
  const state = EditorState.create({
    doc,
    extensions: [extensionsForLanguage('markdown')],
  });
  const lines: string[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      lines.push(`${node.name} [${node.from}-${node.to}] "${doc.slice(node.from, node.to)}"`);
    },
  });
  return lines.join('\n');
}

const SAMPLE = [
  '# H1',
  '',
  '**b** and ~~s~~',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '- [ ] task',
].join('\n');

describe('GFM 节点存在性（SC 回归门）', () => {
  const names = collectNodeNames(SAMPLE);

  it('Strikethrough 与 StrikethroughMark 解析存在', () => {
    expect(names.has('Strikethrough')).toBe(true);
    expect(names.has('StrikethroughMark')).toBe(true);
  });

  it('Table 系节点解析存在', () => {
    expect(names.has('Table')).toBe(true);
  });

  it('Task / TaskMarker 解析存在', () => {
    expect(names.has('Task')).toBe(true);
    expect(names.has('TaskMarker')).toBe(true);
  });

  it('标准节点（标题 / 强调）不被 GFM 影响', () => {
    expect(names.has('ATXHeading1')).toBe(true);
    expect(names.has('StrongEmphasis')).toBe(true);
  });
});

describe('<u> 内联 HTML 配对结构（RESEARCH A2 固化）', () => {
  it('dump <u>x</u> 的实际节点序列', () => {
    // A2：lezer markdown 把 <u>text</u> 解析为开/闭 HTMLTag + 中间纯文本，不成对包裹。
    // 下方快照是执行期固化的真实结构——Wave 1 inlinePlugin 的下划线区间识别据此自配对开闭 HTMLTag。
    expect(dumpNodes('<u>x</u>')).toMatchInlineSnapshot(`
      "Document [0-8] "<u>x</u>"
      Paragraph [0-8] "<u>x</u>"
      HTMLTag [0-3] "<u>"
      HTMLTag [4-8] "</u>""
    `);
  });
});
