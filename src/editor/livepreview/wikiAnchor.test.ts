import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { extensionsForLanguage } from '../languages';
import { findWikiAnchor } from './wikiAnchor';
import { parseWikiTarget } from './wikiTarget';

function locate(doc: string, target: string) {
  return findWikiAnchor(EditorState.create({ doc, extensions: [extensionsForLanguage('markdown')] }), parseWikiTarget(target));
}

describe('正文 Wiki 锚点', () => {
  it('Setext 标题与行内格式标题按可见文字定位', () => {
    const setext = '前文。\n\n研究方法\n========\n内容。';
    expect(locate(setext, '#研究方法')).toMatchObject({ kind: 'found', from: setext.indexOf('研究方法') });
    const formatted = '前文。\n\n## **研究** 与 [方法](https://example.com)\n内容。';
    expect(locate(formatted, '#研究 与 方法')).toMatchObject({ kind: 'found', from: formatted.indexOf('## ') });
  });

  it('重复标题明确返回歧义，不默认跳第一个', () => {
    expect(locate('# 重复\n一。\n\n# 重复\n二。', '#重复')).toEqual({ kind: 'ambiguous', anchor: 'heading', label: '重复' });
  });

  it('heading 与 block 同时存在时，只定位该标题章节内的块', () => {
    const doc = '# 第一节\n\n第一段 ^证据\n\n# 第二节\n\n第二段 ^证据';
    expect(locate(doc, '#第二节^证据')).toMatchObject({ kind: 'found', from: doc.indexOf('第二段') });
    expect(locate(doc, '#^证据')).toEqual({ kind: 'ambiguous', anchor: 'block', label: '证据' });
  });

  it('段后独立块标识定位整个前置段落', () => {
    const doc = '# 标题\n\n段落第一行\n段落第二行\n\n^段落一\n';
    expect(locate(doc, '^段落一')).toMatchObject({ kind: 'found', from: doc.indexOf('段落第一行') });
  });

  it('代码围栏、转义和 frontmatter 中的块示例不能充当正文目标', () => {
    const doc = '---\ntitle: 测试 ^示例\n---\n\n```md\n例子 ^示例\n```\n\n转义 \\^示例\n';
    expect(locate(doc, '#^示例')).toEqual({ kind: 'missing', anchor: 'block', label: '示例' });
  });
});
