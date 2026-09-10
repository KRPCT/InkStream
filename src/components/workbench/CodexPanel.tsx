import { useEffect, useState } from 'react';
import { NotebookTabs, Pencil, Plus, RefreshCw } from 'lucide-react';
import { CODEX_TYPE_LABEL, refreshCodex } from '../../editor/codex';
import { loadCodexEdit, type CodexEdit } from '../../editor/codexActions';
import { openFileByPath } from '../../editor/fileOpenFlow';
import { useCodexStore } from '../../stores/useCodexStore';
import { useVaultStore } from '../../stores/useVaultStore';
import EmptyState from '../common/EmptyState';
import CodexEntryForm from './CodexEntryForm';

export default function CodexPanel() {
  const entries = useCodexStore((state) => state.entries);
  const issues = useCodexStore((state) => state.issues);
  const status = useCodexStore((state) => state.status);
  const scope = useVaultStore((state) => state.vault);
  const [form, setForm] = useState<{ scope: NonNullable<typeof scope>; edit: CodexEdit | null } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (scope) void refreshCodex(scope.root); }, [scope]);
  const edit = async (path: string) => {
    if (!scope) return;
    setError('');
    try { const value = await loadCodexEdit(scope, path); if (useVaultStore.getState().vault === scope) setForm({ scope, edit: value }); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  if (!scope) return <EmptyState icon={NotebookTabs} heading="打开项目后建立 Codex" body="为故事添加角色、地点和设定。" />;
  return <div className="flex h-full flex-col overflow-auto">
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--background-modifier-border)] px-3 text-[12px]">
      <span>Codex {entries.length}</span>
      <button type="button" aria-label="添加条目" title="添加条目" onClick={() => setForm({ scope, edit: null })} className="ml-auto rounded p-1"><Plus size={14} /></button>
      <button type="button" aria-label="重新扫描 Codex" title="重新扫描 Codex" onClick={() => void refreshCodex(scope.root)} className="rounded p-1"><RefreshCw size={13} /></button>
    </div>
    {form && form.scope === scope ? <CodexEntryForm key={form.edit?.path ?? 'new'} scope={scope} edit={form.edit} onClose={() => setForm(null)} /> : <>
      {status === 'loading' && <p role="status" className="px-3 py-1 text-[12px]">正在读取条目…</p>}
      {entries.length === 0 && status !== 'loading' && status !== 'error' && <EmptyState icon={NotebookTabs} heading="Codex 还是空的" body="添加角色、地点或设定后，正文中的名称和别名会显示提及卡片。" />}
      <ul className="py-1">{entries.map((entry) => <li key={entry.path} className="flex items-center px-2">
        <button type="button" aria-label={`打开 ${entry.name}`} title={entry.summary || entry.name} onClick={() => void openFileByPath(entry.path)} className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left text-[13px]">
          <span className="min-w-0 flex-1 truncate">{entry.name}</span><span className="text-[11px] text-[var(--text-muted)]">{CODEX_TYPE_LABEL[entry.type]}</span>
        </button><button type="button" aria-label={`编辑 ${entry.name}`} title={`编辑 ${entry.name}`} onClick={() => void edit(entry.path)} className="p-1"><Pencil size={13} /></button>
      </li>)}</ul>
    </>}
    {(error || issues.length > 0) && <div role="alert" className="px-3 py-2 text-[12px] text-[var(--color-error)]">{error && <p>{error}</p>}{issues.map((issue) => <p key={issue}>{issue}</p>)}</div>}
  </div>;
}
