import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdownToHtml';

describe('markdownToHtml', () => {
  it('标题 1-6', () => {
    expect(markdownToHtml('# A')).toBe('<h1>A</h1>');
    expect(markdownToHtml('###### F')).toBe('<h6>F</h6>');
  });

  it('行内：粗体/斜体/删除线/行内代码', () => {
    expect(markdownToHtml('**b** *i* ~~s~~ `c`')).toBe(
      '<p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code></p>',
    );
  });

  it('链接产出真实 href，图片产出 src/alt', () => {
    expect(markdownToHtml('[t](https://x.com)')).toBe('<p><a href="https://x.com">t</a></p>');
    expect(markdownToHtml('![cap](img.png)')).toContain('<img src="img.png" alt="cap">');
  });

  it('无序/有序列表', () => {
    expect(markdownToHtml('- a\n- b')).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    expect(markdownToHtml('1. a\n2. b')).toBe('<ol><li><p>a</p></li><li><p>b</p></li></ol>');
  });

  it('引用与分割线', () => {
    expect(markdownToHtml('> q')).toBe('<blockquote><p>q</p></blockquote>');
    expect(markdownToHtml('---')).toBe('<hr>');
  });

  it('代码围栏带语言 class', () => {
    expect(markdownToHtml('```js\nx=1\n```')).toBe('<pre><code class="language-js">x=1</code></pre>');
  });

  it('GFM 表格', () => {
    const html = markdownToHtml('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<thead><tr><th>a</th><th>b</th></tr></thead>');
    expect(html).toContain('<tbody><tr><td>1</td><td>2</td></tr></tbody>');
  });

  it('wiki-link 取展示文本（别名优先），不漏源码括号', () => {
    expect(markdownToHtml('[[页面|别名]]')).toBe('<p><span class="wikilink">别名</span></p>');
    expect(markdownToHtml('[[页面]]')).toBe('<p><span class="wikilink">页面</span></p>');
  });

  it('数学：缺 renderMath 降级代码，注入则用渲染器', () => {
    expect(markdownToHtml('$x^2$')).toBe('<p><code>x^2</code></p>');
    const html = markdownToHtml('$x^2$', { renderMath: (s, d) => `<math data-d="${d}">${s}</math>` });
    expect(html).toBe('<p><math data-d="false">x^2</math></p>');
    const block = markdownToHtml('$$y$$', { renderMath: (s, d) => `<math data-d="${d}">${s}</math>` });
    expect(block).toContain('<math data-d="true">y</math>');
  });

  it('剔除 frontmatter，正文从 body 起', () => {
    expect(markdownToHtml('---\ntitle: T\n---\n# Body')).toBe('<h1>Body</h1>');
  });

  it('XSS：正文里的 HTML 一律 escape', () => {
    expect(markdownToHtml('<img src=x onerror=alert(1)>')).toContain('&lt;img');
    expect(markdownToHtml('a < b & c')).toBe('<p>a &lt; b &amp; c</p>');
  });

  it('XSS：危险协议 href/src 落 #（javascript:/data:/vbscript:）', () => {
    expect(markdownToHtml('[x](javascript:alert(1))')).toBe('<p><a href="#">x</a></p>');
    expect(markdownToHtml('[x](vbscript:foo)')).toContain('href="#"');
    expect(markdownToHtml('![a](data:text/html,xx)')).toContain('src="#"');
  });

  it('安全协议与相对路径放行；data:image 内嵌图片放行', () => {
    expect(markdownToHtml('[x](https://a.com)')).toContain('href="https://a.com"');
    expect(markdownToHtml('[x](./page.md)')).toContain('href="./page.md"');
    expect(markdownToHtml('[x](mailto:a@b.com)')).toContain('href="mailto:a@b.com"');
    expect(markdownToHtml('![p](data:image/png;base64,iVBOR)')).toContain(
      'src="data:image/png;base64,iVBOR"',
    );
  });
});
