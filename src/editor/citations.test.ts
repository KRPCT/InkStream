import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { extractCitations } from './citations';

/** 简写：从文本析出引用条目。 */
const cite = (text: string) => extractCitations(EditorState.create({ doc: text }));

describe('extractCitations', () => {
  it('单个 [@key]', () => {
    expect(cite('深度学习见 [@lecunDeepLearning2015]。').map((c) => c.key)).toEqual([
      'lecunDeepLearning2015',
    ]);
  });

  it('多选 [@a; @b]', () => {
    expect(cite('[@a; @b]').map((c) => c.key)).toEqual(['a', 'b']);
  });

  it('计数重复出现', () => {
    expect(cite('[@x] 又见 [@x] 以及 [@y]')).toEqual([
      { key: 'x', count: 2 },
      { key: 'y', count: 1 },
    ]);
  });

  it('忽略邮箱（@ 前是单词字符不算引用）', () => {
    expect(cite('联系 user@example.com 详见 [@realKey]').map((c) => c.key)).toEqual(['realKey']);
  });

  it('中文 citekey', () => {
    expect(cite('[@文献2024]').map((c) => c.key)).toEqual(['文献2024']);
  });

  it('行内 @key（空白后）', () => {
    expect(cite('如 @smith2020 所述').map((c) => c.key)).toEqual(['smith2020']);
  });

  it('按首现顺序去重', () => {
    expect(cite('[@b] [@a] [@b]').map((c) => c.key)).toEqual(['b', 'a']);
  });

  it('空文档 → 空', () => {
    expect(cite('')).toEqual([]);
  });
});
