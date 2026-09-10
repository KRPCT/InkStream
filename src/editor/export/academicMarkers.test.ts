import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdownToHtml';
import { collectWikiReferences } from '../wikiReferences';
import { parseWikiTarget } from '../livepreview/wikiTarget';

describe('学术标记与 HTML 导出', () => {
  it('隐藏合法 bibliography 标记，保留生成的参考文献正文和普通 HTML 的转义', () => {
    const source = ['<!-- biblio:apa -->', 'Author. (2026). Title.', '<!-- /biblio -->', '<script>alert(1)</script>'].join('\n\n');
    const html = markdownToHtml(source);
    expect(html).not.toContain('biblio:apa');
    expect(html).not.toContain('/biblio');
    expect(html).toContain('Author. (2026). Title.');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('未知或附带内容的 HTML 注释仍按原安全规则显示', () => {
    const html = markdownToHtml('<!-- biblio:unknown -->\n\n<!-- biblio:apa unexpected -->\n\n<!-- ordinary -->');
    expect(html).toContain('&lt;!-- biblio:unknown --&gt;');
    expect(html).toContain('&lt;!-- biblio:apa unexpected --&gt;');
    expect(html).toContain('&lt;!-- ordinary --&gt;');
  });

  it('重复或非法公式标签不生成重名 HTML id，未解析引用不伪装为有效链接', () => {
    const html = markdownToHtml('<!-- equation-numbering -->\n\n$$a$$\n<!-- equation:same -->\n\n$$b$$\n<!-- equation:same -->\n\n见 [[#eq:same]]。');
    const document = new DOMParser().parseFromString(html, 'text/html');
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const unresolved = document.querySelector('[data-equation-reference="same"]');
    expect(unresolved).not.toBeNull();
    expect(unresolved?.textContent).toBe('未解析：eq:same');
    expect(document.querySelector('a[data-equation-reference="same"]')).toBeNull();
  });

  it('本地公式 anchor 不产生文件边，普通文件的 heading/block/alias 仍完整保留', () => {
    const text = '见 [[#eq:energy]]、[[#章节]]、[[#^block]]，另见 [[paper#章节^block|原文]]。';
    expect(collectWikiReferences(text).map((reference) => reference.targetPath)).toEqual(['paper']);
    expect(parseWikiTarget('#eq:energy')).toEqual({ path: '', heading: 'eq:energy', block: null });
    expect(parseWikiTarget('paper#章节^block')).toEqual({ path: 'paper', heading: '章节', block: 'block' });
  });
});
