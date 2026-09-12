import { useEditorStore } from '../stores/useEditorStore';
import { useGitGraphStore } from '../stores/useGitGraphStore';
import { useGitStore } from '../stores/useGitStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { showToast } from '../stores/useToastStore';
import { getView } from './viewHandle';
import { stripVerbatim } from './pathUtil';

export function openBranchComparison(): void {
  if (!useGitStore.getState().repoRoot) { showToast('warning', '当前工作区不是 Git 仓库。'); return; }
  useGitGraphStore.setState({ comparisonStart: null });
  useGitGraphStore.getState().setLeftMode('compare');
  useWorkbenchStore.getState().setCentralView('gitGraph');
}

export function currentComparisonDocument(repoRoot: string): { path: string; snippet: string } | null {
  const { activePath, tabs } = useEditorStore.getState();
  const vault = useVaultStore.getState().vault;
  const view = getView();
  if (!activePath || activePath.startsWith('draft://') || !vault || !view) return null;
  const tab = tabs.find((candidate) => candidate.path === activePath);
  const normalize = (path: string) => stripVerbatim(path).replace(/\/+$/, '');
  const absolute = normalize(tab?.external ? activePath : `${vault.root}/${activePath}`);
  const root = normalize(repoRoot);
  const windows = /^[a-z]:/i.test(root) || root.startsWith('//');
  if (!(windows ? absolute.toLowerCase().startsWith(root.toLowerCase() + '/') : absolute.startsWith(root + '/'))) return null;
  const path = absolute.slice(root.length + 1);
  if (path.split('/').some((segment) => segment === '..' || segment === '.')) return null;
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  // Bounded extraction even for a giant single-line document. No dispatch or save occurs.
  const snippet = !selection.empty && selection.to - selection.from <= 1024
    ? view.state.sliceDoc(selection.from, selection.to)
    : view.state.sliceDoc(line.from, Math.min(line.to, line.from + 512));
  return { path, snippet };
}
