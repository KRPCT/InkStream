import { describe, expect, it } from 'vitest';
import { typstSvgElement } from './typstSvg';

describe('同一 Typst SVG 在多处预览', () => {
  it('每次挂载的定义与引用使用独立 ID，多个块不会引用另一张图的 glyph 或 clip', () => {
    const source = '<svg><defs><path id="glyph" d="M0 0L1 1"/></defs><use href="#glyph"/></svg>';
    const first = typstSvgElement(source)!;
    const second = typstSvgElement(source)!;
    expect(first.querySelector('path')!.id).not.toBe(second.querySelector('path')!.id);
    expect(first.querySelector('use')!.getAttribute('href')).toBe('#' + first.querySelector('path')!.id);
    expect(second.querySelector('use')!.getAttribute('href')).toBe('#' + second.querySelector('path')!.id);
  });

  it('保留并重写本地 gradient 引用，不把带引号的本地 URL 当外部资源', () => {
    const result = typstSvgElement('<svg><defs><linearGradient id="shade"/></defs><rect style="fill:url(&quot;#shade&quot;)"/></svg>')!;
    expect(result.querySelector('rect')!.getAttribute('style')).toContain('#' + result.querySelector('linearGradient')!.id);
  });

  it('移除脚本、事件和外部引用，保留编译出的几何路径', () => {
    const result = typstSvgElement('<svg onload="alert(1)"><script>alert(2)</script><foreignObject><p>foreign</p></foreignObject><image href="https://example.invalid/a.png"/><path d="M0 0L1 1"/></svg>')!;
    expect(result.querySelector('script,foreignObject')).toBeNull();
    expect(result.getAttribute('onload')).toBeNull();
    expect(result.querySelector('image')!.getAttribute('href')).toBeNull();
    expect(result.querySelector('path')!.getAttribute('d')).toBe('M0 0L1 1');
  });
});
