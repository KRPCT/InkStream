import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 安全回归门：阅读 iframe 渲染不可信 docx/epub，必须永不取得脚本执行权。
 * allow-same-origin（让父框测量子文档滚动位以续读）可；但一旦加入 allow-scripts，
 * 内容即可执行脚本、读 token/localStorage 并可改写 sandbox 逃逸——硬禁。
 */
describe('reading iframe sandbox', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/reading/HtmlReader.tsx'), 'utf8');
  const sandbox = src.match(/sandbox="([^"]*)"/);

  it('declares a sandbox attribute', () => {
    expect(sandbox).not.toBeNull();
  });

  it('never grants allow-scripts to untrusted content', () => {
    expect(sandbox![1]).not.toContain('allow-scripts');
  });

  it('grants only same-origin (for parent-side scroll measurement)', () => {
    expect(sandbox![1]).toBe('allow-same-origin');
  });
});
