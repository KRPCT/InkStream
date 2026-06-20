import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFocusModeStore } from '../../stores/useFocusModeStore';
import { focusModePlugin } from './focusMode';

function makeView(doc: string, head: number): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(head),
      extensions: [focusModePlugin],
    }),
    parent,
  });
}
function dimmedLines(v: EditorView): number[] {
  const set = v.plugin(focusModePlugin)?.decorations;
  const nums: number[] = [];
  set?.between(0, v.state.doc.length, (from) => {
    nums.push(v.state.doc.lineAt(from).number);
  });
  return nums;
}

// 行：1=A1 2=A2 3=空 4=B1 5=空 6=C1（A 段=1-2，B 段=4，C 段=6）
const DOC = 'A1\nA2\n\nB1\n\nC1';

beforeEach(() => {
  useFocusModeStore.setState({ active: true });
});

describe('focusMode（CREA-03）', () => {
  it('开启时淡化非光标段落行，光标所在段落不淡化', () => {
    const v = makeView(DOC, 1); // 光标在 A 段
    const dim = dimmedLines(v);
    expect(dim).not.toContain(1);
    expect(dim).not.toContain(2);
    expect(dim).toContain(4); // B 段
    expect(dim).toContain(6); // C 段
    v.destroy();
  });

  it('关闭时无淡化', () => {
    useFocusModeStore.setState({ active: false });
    const v = makeView(DOC, 1);
    expect(dimmedLines(v)).toEqual([]);
    v.destroy();
  });

  it('全文无空行分段时退化为只淡化光标行以外的行（否则淡化不可见）', () => {
    const v = makeView('行一\n行二\n行三\n行四', 4); // 光标第二行，全文无空行
    const dim = dimmedLines(v);
    expect(dim).not.toContain(2); // 光标行不淡化
    expect(dim.slice().sort()).toEqual([1, 3, 4]); // 其余行全部淡化
    v.destroy();
  });
});

describe('focusMode IME 契约（逐字复制 inlinePlugin 冻结门）', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/editor/livepreview/focusMode.ts'), 'utf8');
  it('update 含组合期短路 + docChanged map 旧集不重建', () => {
    expect(src).toContain('if (!refreshed && isComposing(u.view))');
    expect(src).toContain('this.decorations = this.decorations.map(u.changes)');
  });
});
