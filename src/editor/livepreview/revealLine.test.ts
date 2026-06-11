import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { cursorInRange, isCursorOnLineOf } from './revealLine';

/**
 * 光标行还原纯函数工具回归门（D-07「显标记保排版」的判定基元）。
 */

/** 在指定光标位置构建 state。 */
function stateWithCursor(doc: string, head: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: head } });
}

describe('cursorInRange', () => {
  const doc = '# H1\n正文';

  it('光标落在 [from,to] 内返回 true', () => {
    const state = stateWithCursor(doc, 2); // 落在 "# H1"（0-4）内
    expect(cursorInRange(state, 0, 4)).toBe(true);
  });

  it('光标在 range 边界（含端点）返回 true', () => {
    const state = stateWithCursor(doc, 4);
    expect(cursorInRange(state, 0, 4)).toBe(true);
    const atStart = stateWithCursor(doc, 0);
    expect(cursorInRange(atStart, 0, 4)).toBe(true);
  });

  it('光标在 range 外返回 false', () => {
    const state = stateWithCursor(doc, 6); // 落在第二行
    expect(cursorInRange(state, 0, 4)).toBe(false);
  });
});

describe('isCursorOnLineOf', () => {
  const doc = '# H1\n正文段落';

  it('光标与 pos 同行返回 true', () => {
    const state = stateWithCursor(doc, 1); // 第一行
    expect(isCursorOnLineOf(state, 3)).toBe(true); // pos 3 也在第一行
  });

  it('光标与 pos 不同行返回 false', () => {
    const state = stateWithCursor(doc, 1); // 第一行
    expect(isCursorOnLineOf(state, 6)).toBe(false); // pos 6 在第二行
  });
});
