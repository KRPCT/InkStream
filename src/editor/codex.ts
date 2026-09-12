import { readFile } from '../ipc/files';
import { listDir } from '../ipc/vault';
import { useCodexStore } from '../stores/useCodexStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useEditorStore } from '../stores/useEditorStore';
import type { CodexEntry } from '../types/creative';
import { queueAfterComposition, refreshLivePreview } from './composition';
import { getDocForPath } from './editorState';
import { parseCodexEntry } from './codexMetadata';
import { getView } from './viewHandle';
export { CODEX_TYPE_LABEL } from './codexMetadata';

let generation = 0;
let scanController: AbortController | null = null;
async function scan(root: string, signal?: AbortSignal): Promise<{ entries: CodexEntry[]; issues: string[] }> {
  const parent = await listDir(root, '');
  signal?.throwIfAborted();
  if (!parent.some((item) => item.isDir && item.name === 'Codex')) return { entries: [], issues: [] };
  const files = (await listDir(root, 'Codex')).filter((entry) => !entry.isDir && /\.(md|markdown|txt)$/i.test(entry.name) && !entry.name.startsWith('.'));
  signal?.throwIfAborted();
  const entries: CodexEntry[] = [];
  const issues: string[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
    while (cursor < files.length) {
      signal?.throwIfAborted();
      const file = files[cursor++];
      const path = `Codex/${file.name}`;
      try {
        const text = useVaultStore.getState().vault?.root === root ? getDocForPath(path) : null;
        entries.push(parseCodexEntry(path, text ?? await readFile(root, path, { signal })));
      } catch (error) { signal?.throwIfAborted(); issues.push(`${path}：${error instanceof Error ? error.message : String(error)}`); }
    }
  }));
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const triggers = new Map<string, string>();
  for (const entry of entries) for (const trigger of new Set([entry.name, ...entry.aliases])) {
    const key = trigger.normalize('NFC');
    const prior = triggers.get(key);
    if (prior && prior !== entry.path) issues.push(`「${trigger}」同时属于 ${prior} 和 ${entry.path}；不会猜测悬停目标。`);
    triggers.set(key, entry.path);
  }
  return { entries, issues };
}

export async function buildCodex(root: string): Promise<CodexEntry[]> { return (await scan(root)).entries; }

export async function refreshCodex(root: string): Promise<void> {
  const scope = useVaultStore.getState().vault;
  if (scope?.root !== root) return;
  const request = ++generation;
  scanController?.abort();
  const controller = new AbortController();
  scanController = controller;
  const current = () => request === generation && useVaultStore.getState().vault === scope;
  useCodexStore.setState({ status: 'loading', issues: [] });
  try {
    const result = await scan(root, controller.signal);
    if (!current()) return;
    useCodexStore.setState({ ...result, status: 'ready' });
    const view = getView();
    if (view) queueAfterComposition(view, 'codex-refresh', () => {
      if (current() && getView() === view) view.dispatch({ effects: refreshLivePreview.of(null) });
    });
  } catch (error) {
    if (current()) useCodexStore.setState({ status: 'error', issues: [`读取 Codex 失败：${error instanceof Error ? error.message : String(error)}`] });
  }
}

/** App-owned lifetime retires scans and refreshes after relevant files change. */
export function initCodexLifecycle(): () => void {
  const stopVault = useVaultStore.subscribe((state, previous) => {
    if (state.vault !== previous.vault) {
      ++generation;
      scanController?.abort();
      useCodexStore.setState({ entries: [], issues: [], status: 'idle' });
      if (state.vault) void refreshCodex(state.vault.root);
    } else if (state.files !== previous.files && state.vault) void refreshCodex(state.vault.root);
  });
  const stopEditor = useEditorStore.subscribe((state, previous) => {
    if (Object.keys(previous.dirty).some((path) => path.startsWith('Codex/') && previous.dirty[path] && !state.dirty[path])) {
      const root = useVaultStore.getState().vault?.root;
      if (root) void refreshCodex(root);
    }
  });
  return () => { stopVault(); stopEditor(); ++generation; scanController?.abort(); scanController = null; };
}
