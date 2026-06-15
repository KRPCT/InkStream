import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCodexStore } from '../../stores/useCodexStore';
import type { CodexEntry } from '../../types/creative';
import { codexMentionPlugin } from './codexMention';

function makeView(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({ doc, extensions: [codexMentionPlugin] }),
    parent,
  });
}
function markTexts(v: EditorView): string[] {
  const set = v.plugin(codexMentionPlugin)?.decorations;
  const out: string[] = [];
  set?.between(0, v.state.doc.length, (from, to) => {
    out.push(v.state.sliceDoc(from, to));
  });
  return out;
}

const LIN: CodexEntry = {
  path: 'Codex/林深.md',
  type: 'character',
  name: '林深',
  aliases: ['小林'],
  summary: 's',
};
const SAM: CodexEntry = { path: 'Codex/Sam.md', type: 'character', name: 'Sam', aliases: [], summary: '' };

beforeEach(() => {
  useCodexStore.setState({ entries: [LIN, SAM] });
});

describe('codexMention 提及高亮（CREA-02）', () => {
  it('CJK 名在连续中文里命中（无空格）+ alias；Latin 名遵词边界（不命中 Sample 内）', () => {
    const v = makeView('林深走来。小林说。Sam 来了，但 Sample 不是。');
    const m = markTexts(v);
    expect(m).toContain('林深'); // CJK 连续文本命中
    expect(m).toContain('小林'); // alias 命中
    expect(m.filter((t) => t === 'Sam').length).toBe(1); // Sample 内不命中（Latin 词边界）
    v.destroy();
  });

  it('无条目 → 无装饰', () => {
    useCodexStore.setState({ entries: [] });
    const v = makeView('林深走来');
    expect(markTexts(v)).toEqual([]);
    v.destroy();
  });
});

describe('codexMention IME 契约（逐字复制 inlinePlugin 冻结门）', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/editor/livepreview/codexMention.ts'), 'utf8');
  it('update 含组合期短路：isComposing 守门 + docChanged 时 map 旧集不重建', () => {
    expect(src).toContain('if (!refreshed && isComposing(u.view))');
    expect(src).toContain('this.decorations = this.decorations.map(u.changes)');
  });
});
