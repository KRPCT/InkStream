import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useWordCountStore } from '../stores/useWordCountStore';
import {
  configureWordCount,
  extractWordCount,
  rebaseWordCount,
  resetWordCount,
  syncWordCount,
} from './wordCount';

/** 只用 view.state 的桩（sync/rebase 仅访问 view.state）。 */
function viewOf(doc: string): EditorView {
  return { state: EditorState.create({ doc }) } as unknown as EditorView;
}

beforeEach(() => {
  resetWordCount();
  configureWordCount({ dayKey: () => 'D1' });
  useWordCountStore.setState({ activeCount: 0, todayWritten: 0 });
});

describe('extractWordCount', () => {
  it('剔除 frontmatter 只数正文（中英混合）', () => {
    const s = EditorState.create({ doc: '---\ntitle: 雨夜\n---\n你好 world' });
    expect(extractWordCount(s)).toBe(3); // 你 + 好 + world
  });
});

describe('今日净写入（syncWordCount / rebaseWordCount）', () => {
  it('打开既有文档不计为今日写入；后续编辑才累加净增量', () => {
    rebaseWordCount(viewOf('一二三四五')); // 基线 5，今日不变
    expect(useWordCountStore.getState().todayWritten).toBe(0);
    expect(useWordCountStore.getState().activeCount).toBe(5);
    syncWordCount(viewOf('一二三四五六七')); // +2
    expect(useWordCountStore.getState().todayWritten).toBe(2);
    expect(useWordCountStore.getState().activeCount).toBe(7);
  });

  it('切 tab（rebase）不计入今日写入，跨文档累计净增量', () => {
    rebaseWordCount(viewOf('aaa bbb')); // 基线 2
    syncWordCount(viewOf('aaa bbb ccc')); // +1 → 1
    expect(useWordCountStore.getState().todayWritten).toBe(1);
    rebaseWordCount(viewOf('xxx')); // 切到新文档：基线 1，今日不变
    expect(useWordCountStore.getState().todayWritten).toBe(1);
    syncWordCount(viewOf('xxx yyy')); // +1 → 2
    expect(useWordCountStore.getState().todayWritten).toBe(2);
  });

  it('删减计负、今日写入夹至 ≥0', () => {
    rebaseWordCount(viewOf('a b c d e')); // 基线 5
    syncWordCount(viewOf('a b')); // -3 → 夹 0
    expect(useWordCountStore.getState().todayWritten).toBe(0);
  });

  it('换日重置今日写入', () => {
    rebaseWordCount(viewOf('a b')); // 基线 2
    syncWordCount(viewOf('a b c')); // +1（D1）→ 1
    expect(useWordCountStore.getState().todayWritten).toBe(1);
    configureWordCount({ dayKey: () => 'D2' }); // 跨日
    syncWordCount(viewOf('a b c d')); // 换日归零再 +1 → 1
    expect(useWordCountStore.getState().todayWritten).toBe(1);
  });
});
