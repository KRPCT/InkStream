import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDraftCounterForTest, isDraftPath, nextDraft } from './draftPath';

describe('draftPath', () => {
  beforeEach(() => {
    __resetDraftCounterForTest();
  });

  it('nextDraft 递增分配 draft://N 与「未命名-N」', () => {
    expect(nextDraft()).toEqual({ path: 'draft://1', name: '未命名-1' });
    expect(nextDraft()).toEqual({ path: 'draft://2', name: '未命名-2' });
  });

  it('isDraftPath 仅识别 draft:// 前缀', () => {
    expect(isDraftPath('draft://1')).toBe(true);
    expect(isDraftPath('notes/draft.md')).toBe(false);
    expect(isDraftPath('a.md')).toBe(false);
  });
});
