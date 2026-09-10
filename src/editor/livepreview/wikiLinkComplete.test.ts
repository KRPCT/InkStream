import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { useVaultStore } from '../../stores/useVaultStore';
import { wikiLinkSource } from './wikiLinkComplete';

/** `[[` wiki-link 文件名补全源（Phase 4 W3 / LINK-02）。 */

function ctxAt(doc: string): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, doc.length, false);
}

beforeEach(() => {
  useVaultStore.setState({
    vault: { root: '/v', repoRoot: null, name: 'v' },
    tree: [],
    files: [
      { name: '中文页.md', path: '笔记/中文页.md' },
      { name: 'english.md', path: 'english.md' },
    ],
    expanded: new Set(),
  });
});

describe('wikiLinkSource', () => {
  it('[[ 后（空 query）弹全部文件，from 落 [[ 起点', () => {
    const r = wikiLinkSource(ctxAt('[['));
    expect(r).not.toBeNull();
    expect(r!.from).toBe(0);
    expect(r!.options.map((o) => o.label)).toEqual(
      expect.arrayContaining(['中文页.md', 'english.md']),
    );
  });

  it('[[中文 fuzzy 命中中文页，插入确定路径并以文件名作显示别名', () => {
    const r = wikiLinkSource(ctxAt('[[中文'));
    expect(r!.options[0].label).toBe('中文页.md');
    expect(r!.options[0].apply).toBe('[[笔记/中文页|中文页]]');
    expect(r!.options[0].detail).toBe('笔记/中文页.md');
  });

  it('同名候选按所选目录插入链接，不丢失文件身份', () => {
    useVaultStore.getState().setFiles([
      { name: '重复.md', path: '甲/重复.md' },
      { name: '重复.md', path: '乙/重复.md' },
    ]);
    const result = wikiLinkSource(ctxAt('[[重复'));
    const selected = result?.options.find((option) => option.detail === '乙/重复.md');
    expect(selected?.apply).toBe('[[乙/重复|重复]]');
  });

  it('非 [[ 上下文 / 单括号 → null', () => {
    expect(wikiLinkSource(ctxAt('普通文本'))).toBeNull();
    expect(wikiLinkSource(ctxAt('[单括号'))).toBeNull();
  });

  it('已闭合 ]] 后不触发（matchBefore 不含 ]）', () => {
    expect(wikiLinkSource(ctxAt('[[x]]'))).toBeNull();
  });

  it('无 vault / 空文件清单 → null', () => {
    useVaultStore.setState({ vault: null, files: [] });
    expect(wikiLinkSource(ctxAt('[['))).toBeNull();
  });
});
