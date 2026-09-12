import { describe, expect, it } from 'vitest';
import { collectWikiReferences, findReferenceRange, hasUnlinkedMention } from './wikiReferences';

describe('wiki 引用段落与当前位置', () => {
  it('长段落仅回传有界上下文，仍能在段落移动后准确重定位', () => {
    const paragraph = '长文前缀。'.repeat(800) + '独特上下文 [[目标]] 尾部。' + '长文后缀。'.repeat(800);
    const reference = collectWikiReferences(paragraph)[0];
    expect(reference.context.length).toBeLessThanOrEqual(1024);
    const changed = '新段落。\n\n' + paragraph;
    const from = changed.indexOf('[[目标]]');
    expect(findReferenceRange(changed, reference)).toEqual({ from, to: from + 6 });
  });
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

describe('未链接提及只属于正文', () => {
  it('支持短中文和规范化文字，ASCII 名称不嵌进另一单词', () => {
    expect(hasUnlinkedMention('研究方法中包含资料。', '研究')).toBe(true);
    expect(hasUnlinkedMention('Cafe\u0301 的笔记', 'Café')).toBe(true);
    expect(hasUnlinkedMention('FOO appears here.', 'foo')).toBe(true);
    expect(hasUnlinkedMention('food is different', 'foo')).toBe(false);
  });

  it('关联集合超过展示预算时明确失败，不交付截断的完整假象', () => {
    const text = ('前后上下文。'.repeat(80) + '[[研究]]。').repeat(2_000);
    expect(() => collectWikiReferences(text)).toThrow('超过显示预算');
  });
  it.each(['`研究`', '```md\n研究\n```', '    研究', '<!-- 研究 -->', '<!--\n研究\n-->', '[[研究]]', '[研究](url)', '$研究$', '$$\n研究\n$$', ':::typst\n研究\n:::'])('排除 %s', (doc) => {
    expect(hasUnlinkedMention(doc, '研究')).toBe(false);
  });
  it('Raw CRLF 范围映射到 CodeMirror LF 文本', () => {
    const raw = '头部\r\n\r\n中文 [[目标]]。\r\n';
    const doc = raw.replaceAll('\r\n', '\n');
    const reference = collectWikiReferences(raw)[0];
    expect(findReferenceRange(doc, reference)).toEqual({ from: doc.indexOf('[['), to: doc.indexOf('[[') + 6 });
  });
});
