import { describe, expect, it } from 'vitest';
import { buildHtmlDocument } from './htmlDocument';

const META = { title: 'My Doc', brandingFooter: true, generator: 'InkStream 1.2.3' };

describe('buildHtmlDocument', () => {
  it('包成自包含 HTML 文档 + 写入生成器元数据 + 标题 + 内联样式', () => {
    const doc = buildHtmlDocument('<h1>Hi</h1>', META);
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<meta name="generator" content="InkStream 1.2.3">');
    expect(doc).toContain('<title>My Doc</title>');
    expect(doc).toContain('<h1>Hi</h1>');
    expect(doc).toContain('<style>');
  });

  it('品牌页脚开启时附 Made with InkStream', () => {
    expect(buildHtmlDocument('<p>x</p>', META)).toContain('Made with InkStream');
  });

  it('品牌页脚关闭时无页脚', () => {
    expect(buildHtmlDocument('<p>x</p>', { ...META, brandingFooter: false })).not.toContain(
      'Made with InkStream',
    );
  });

  it('标题转义防注入', () => {
    const doc = buildHtmlDocument('<p>x</p>', { ...META, title: '<script>' });
    expect(doc).toContain('<title>&lt;script&gt;</title>');
    expect(doc).not.toContain('<title><script>');
  });
});
