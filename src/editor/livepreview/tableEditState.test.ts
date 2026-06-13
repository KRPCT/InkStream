import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { clearTableEdit, setTableEdit, tableEditState } from './tableEditState';

/**
 * 就地编辑态 StateField 回归门（TABLE-WYSIWYG-DESIGN §2.2 / Wave 1）。
 *
 * 断言：set/clear effect 切换、docChanged 时 tableFrom 经 mapPos 跟随位移（编辑态不漂移）。
 */

function freshState(doc = 'x\n\n| a | b |\n| - | - |\n| 1 | 2 |'): EditorState {
  return EditorState.create({ doc, extensions: [tableEditState] });
}

describe('tableEditState 切换', () => {
  it('初始 null', () => {
    expect(freshState().field(tableEditState)).toBeNull();
  });

  it('setTableEdit → 持该值', () => {
    const next = freshState().update({
      effects: setTableEdit.of({ tableFrom: 3, cellIndex: 1 }),
    }).state;
    expect(next.field(tableEditState)).toEqual({ tableFrom: 3, cellIndex: 1 });
  });

  it('clearTableEdit → null', () => {
    const set = freshState().update({
      effects: setTableEdit.of({ tableFrom: 3, cellIndex: 1 }),
    }).state;
    const cleared = set.update({ effects: clearTableEdit.of(null) }).state;
    expect(cleared.field(tableEditState)).toBeNull();
  });

  it('后到 setTableEdit 覆盖前者（单一编辑焦点）', () => {
    let s = freshState();
    s = s.update({ effects: setTableEdit.of({ tableFrom: 3, cellIndex: 0 }) }).state;
    s = s.update({ effects: setTableEdit.of({ tableFrom: 3, cellIndex: 2 }) }).state;
    expect(s.field(tableEditState)).toEqual({ tableFrom: 3, cellIndex: 2 });
  });
});

describe('tableEditState docChanged 跟随位移', () => {
  it('文首插入 → tableFrom 经 mapPos 右移（编辑态不丢失）', () => {
    const set = freshState().update({
      effects: setTableEdit.of({ tableFrom: 3, cellIndex: 1 }),
    }).state;
    const after = set.update({ changes: { from: 0, insert: '你好' } }).state;
    expect(after.field(tableEditState)).toEqual({ tableFrom: 5, cellIndex: 1 });
  });

  it('编辑态后的插入不影响 tableFrom', () => {
    const set = freshState().update({
      effects: setTableEdit.of({ tableFrom: 3, cellIndex: 1 }),
    }).state;
    const after = set.update({ changes: { from: 10, insert: 'z' } }).state;
    expect(after.field(tableEditState)!.tableFrom).toBe(3);
  });
});
