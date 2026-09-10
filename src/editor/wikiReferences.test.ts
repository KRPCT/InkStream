import { describe, expect, it } from 'vitest';
import { collectWikiReferences, findReferenceRange } from './wikiReferences';

describe('wiki 引用段落与当前位置', () => {
  it('保留 emoji 后 UTF-16 范围、多行段落与同段重复引用，忽略代码/转义/注释', () => {
    const paragraph = '😀中文 [[目标]] 继续\n再次 [[目标|别名]]。';
    const doc = `${paragraph}\n\n\`[[目标]]\` \\[[目标]] <!-- [[目标]] -->\n\n\`\`\`md\n[[目标]]\n\`\`\`\n\n    [[目标]]`;
    const refs = collectWikiReferences(doc);
    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => [ref.from, ref.to])).toEqual([
      [paragraph.indexOf('[[目标]]'), paragraph.indexOf('[[目标]]') + '[[目标]]'.length],
      [paragraph.indexOf('[[目标|别名]]'), paragraph.indexOf('[[目标|别名]]') + '[[目标|别名]]'.length],
    ]);
    expect(refs.every((ref) => ref.context === paragraph && ref.contextFrom === 0)).toBe(true);
  });

  it('段落重排时按引用所在段落定位，不跳到同名链接首处', () => {
    const a = '第一段 [[目标]]。';
    const b = '第二段 [[目标]]。';
    const ref = collectWikiReferences(`${a}\n\n${b}`)[1];
    const current = `${b}\n\n新内容😀\n\n${a}`;
    const from = current.indexOf('[[');
    expect(findReferenceRange(current, ref)).toEqual({ from, to: from + ref.linkText.length });
  });

  it('链接被删或变成代码时不沿用旧偏移；完全相同段落重复时报告歧义', () => {
    const context = '重复段 [[目标]]。';
    const ref = collectWikiReferences(context)[0];
    expect(findReferenceRange('引用已经删除。', ref)).toBeNull();
    expect(findReferenceRange('`[[目标]]`', ref)).toBeNull();
    expect(findReferenceRange(`${context}\n\n${context}`, ref)).toBeNull();
    const selected = collectWikiReferences(`其他段 [[目标]]。\n\n${context}`)[1];
    expect(findReferenceRange('其他段 [[目标]]。', selected)).toBeNull();
  });
});
