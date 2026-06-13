import { describe, expect, it } from 'vitest';
import { renderInlineCell } from './renderInlineCell';

/** 把渲染片段挂到一个 div 上便于查询。 */
function render(text: string): HTMLDivElement {
  const host = document.createElement('div');
  host.appendChild(renderInlineCell(text));
  return host;
}

describe('renderInlineCell 行内 markdown → DOM（表格单元格）', () => {
  it('加粗 **x** → <strong>，标记字符不显', () => {
    const host = render('**粗体**');
    const strong = host.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('粗体');
    expect(host.textContent).toBe('粗体'); // ** 隐藏。
  });

  it('斜体 *x* → <em>', () => {
    const host = render('*斜体*');
    expect(host.querySelector('em')?.textContent).toBe('斜体');
    expect(host.textContent).toBe('斜体');
  });

  it('行内代码 `x` → <code class=cm-ink-code>', () => {
    const host = render('`代码`');
    const code = host.querySelector('code');
    expect(code?.classList.contains('cm-ink-code')).toBe(true);
    expect(code?.textContent).toBe('代码');
  });

  it('删除线 ~~x~~ → span.cm-ink-strike（GFM）', () => {
    const host = render('~~删除~~');
    expect(host.querySelector('.cm-ink-strike')?.textContent).toBe('删除');
  });

  it('链接 [t](u) → span.cm-link 仅文字、隐 url、不生成 <a>（防 webview 跳转）', () => {
    const host = render('[链接](https://x.com)');
    const link = host.querySelector('.cm-link');
    expect(link?.textContent).toBe('链接');
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toBe('链接'); // url 不显。
  });

  it('混排：纯文本 + 多个行内元素按序', () => {
    const host = render('前 **粗** 中 *斜* 后');
    expect(host.querySelector('strong')?.textContent).toBe('粗');
    expect(host.querySelector('em')?.textContent).toBe('斜');
    expect(host.textContent).toBe('前 粗 中 斜 后');
  });

  it('纯文本不带标记 → 原样文本（无元素）', () => {
    const host = render('姓名');
    expect(host.textContent).toBe('姓名');
    expect(host.querySelector('strong, em, code, .cm-link')).toBeNull();
  });

  it('空串 → 空片段', () => {
    expect(render('').textContent).toBe('');
  });

  it('XSS：<img onerror> 作纯文本，不生成 img 元素', () => {
    const host = render('<img src=x onerror=alert(1)>');
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img');
    expect(host.textContent).toContain('onerror');
  });

  it('硬换行（<br> 经 unescapePipes 转 \\n）→ <br> 分段', () => {
    const host = render('上\n下');
    expect(host.querySelector('br')).not.toBeNull();
    expect(host.textContent).toBe('上下');
  });

  it('转义 \\* → 字面 *（不触发斜体）', () => {
    const host = render('a\\*b');
    expect(host.querySelector('em')).toBeNull();
    expect(host.textContent).toBe('a*b');
  });
});
