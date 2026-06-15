import { describe, expect, it } from 'vitest';
import { extractSceneSummary } from './sceneSummary';

describe('extractSceneSummary（CREA-05）', () => {
  it('取 frontmatter summary（单行，可含空格）', () => {
    expect(extractSceneSummary('---\ntitle: 雨夜\nsummary: 主角初遇反派\n---\n正文')).toBe('主角初遇反派');
    expect(extractSceneSummary('---\nsummary: In the rain they meet\n---\n')).toBe(
      'In the rain they meet',
    );
  });

  it('无 summary / 无 frontmatter → 空串', () => {
    expect(extractSceneSummary('---\ntitle: 雨夜\n---\n正文')).toBe('');
    expect(extractSceneSummary('# 无 frontmatter')).toBe('');
  });
});
