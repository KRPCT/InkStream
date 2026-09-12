import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { currentComparisonDocument, openBranchComparison } from './gitCompareActions';
import { setView } from './viewHandle';
import { useEditorStore } from '../stores/useEditorStore';
import { useGitGraphStore } from '../stores/useGitGraphStore';
import { useGitStore } from '../stores/useGitStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';

let view: EditorView;
beforeEach(() => {
  view = new EditorView({ state: EditorState.create({ doc: '尚未保存的正文。' }) }); setView(view);
  useEditorStore.setState({ activePath: '章节.md', tabs: [{ path: '章节.md', name: '章节.md' }], dirty: { '章节.md': true } });
});
afterEach(() => { view.destroy(); setView(null); });

it.each([
  ['\\\\?\\D:\\repo\\drafts', 'D:\\repo'],
  ['D:\\repo\\drafts', '\\\\?\\D:\\repo'],
  ['d:\\Repo\\drafts', 'D:\\repo'],
])('当前文档定位兼容规范化路径 %s → %s', (root, repo) => {
  useVaultStore.setState({ vault: { root, repoRoot: repo, name: 'fixture' } });
  expect(currentComparisonDocument(repo)).toEqual({ path: 'drafts/章节.md', snippet: '尚未保存的正文。' });
  expect(view.state.doc.toString()).toBe('尚未保存的正文。');
  expect(useEditorStore.getState().dirty['章节.md']).toBe(true);
});
it('库外文档和临时草稿不会错误地定位到仓库文件', () => {
  useVaultStore.setState({ vault: { root: '/repo', repoRoot: '/repo', name: 'fixture' } });
  useEditorStore.setState({ activePath: '/repo-other/a.md', tabs: [{ path: '/repo-other/a.md', name: 'a.md', external: true }] });
  expect(currentComparisonDocument('/repo')).toBeNull();
  useEditorStore.setState({ activePath: 'draft://1' });
  expect(currentComparisonDocument('/repo')).toBeNull();
});
it('从命令进入比较只切显示模式，未保存正文和标签不变', () => {
  useGitStore.setState({ repoRoot: '/repo' });
  openBranchComparison();
  expect(useGitGraphStore.getState().leftMode).toBe('compare');
  expect(useWorkbenchStore.getState().centralView).toBe('gitGraph');
  expect(view.state.doc.toString()).toBe('尚未保存的正文。');
  expect(useEditorStore.getState().activePath).toBe('章节.md');
  expect(useEditorStore.getState().dirty['章节.md']).toBe(true);
});
