import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { useTypewriterStore } from '../../stores/useTypewriterStore';
import { toggleTypewriter, typewriterPlugin } from './typewriter';

function makeView(doc: string, head: number): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(head),
      extensions: [typewriterPlugin],
    }),
    parent,
  });
}

afterEach(() => {
  useTypewriterStore.setState({ active: false });
});

describe('typewriter（打字机模式）', () => {
  it('开启时在 .cm-editor 上挂 cm-ink-tw class（驱动 50vh 留白）', () => {
    useTypewriterStore.setState({ active: true });
    const v = makeView('hello\nworld', 2);
    v.dispatch({ selection: EditorSelection.cursor(3) }); // 触发一次 update → sync 落 class（同真实使用）
    expect(v.dom.classList.contains('cm-ink-tw')).toBe(true);
    v.destroy();
  });

  it('关闭时不挂 class', () => {
    useTypewriterStore.setState({ active: false });
    const v = makeView('hello\nworld', 2);
    v.dispatch({ selection: EditorSelection.cursor(3) });
    expect(v.dom.classList.contains('cm-ink-tw')).toBe(false);
    v.destroy();
  });

  it('toggleTypewriter 翻转全局开关', () => {
    expect(useTypewriterStore.getState().active).toBe(false);
    toggleTypewriter();
    expect(useTypewriterStore.getState().active).toBe(true);
    toggleTypewriter();
    expect(useTypewriterStore.getState().active).toBe(false);
  });
});

describe('typewriter IME 契约（组合期不滚动）', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/editor/livepreview/typewriter.ts'), 'utf8');
  it('update 组合期短路（不在 isComposing 时滚动）', () => {
    expect(src).toContain('if (!refreshed && isComposing(u.view)) return');
  });
});
