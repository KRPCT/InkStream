import { describe, expect, it } from 'vitest';
import { htmlToDocxBlob } from './exportDocx';

const META = {
  title: 'D',
  brandingFooter: true,
  brandingText: 'Made with InkStream',
  generator: 'InkStream 1.0.0',
};

describe('htmlToDocxBlob', () => {
  it('从正文 HTML 产出非空 DOCX Blob', async () => {
    const html = '<h1>标题</h1><p>正文 <strong>粗</strong> <em>斜</em></p><ul><li><p>项</p></li></ul>';
    const blob = await htmlToDocxBlob(html, META);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('引用 / 代码 / 表格 / 分割线均不抛错', async () => {
    const html =
      '<blockquote><p>q</p></blockquote><pre><code>x=1</code></pre><hr>' +
      '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';
    const blob = await htmlToDocxBlob(html, { ...META, brandingFooter: false });
    expect(blob.size).toBeGreaterThan(0);
  });

  it('嵌套列表与多行代码块不抛错', async () => {
    const html =
      '<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul><pre><code>l1\nl2\nl3</code></pre>';
    const blob = await htmlToDocxBlob(html, META);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('data: 图在无 canvas 环境回落占位文本，不挂死/不抛错', async () => {
    // jsdom 无 2d context → dataUriToPng 提前返回 null → img 走 [图片:…] 占位分支（真机经 canvas 内嵌）。
    const html = '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="封面"></p>';
    const blob = await htmlToDocxBlob(html, META);
    expect(blob.size).toBeGreaterThan(0);
  });
});
