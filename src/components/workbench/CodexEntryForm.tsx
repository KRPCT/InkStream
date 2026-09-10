import { useState, type FormEvent } from 'react';
import { createCodexEntry, saveCodexEntry, type CodexEdit } from '../../editor/codexActions';
import { CODEX_TYPE_LABEL, type CodexFields } from '../../editor/codexMetadata';
import type { CodexType } from '../../types/creative';
import type { VaultInfo } from '../../types/vault';

export default function CodexEntryForm({ scope, edit, onClose }: { scope: VaultInfo; edit: CodexEdit | null; onClose: () => void }) {
  const initial = edit?.fields;
  const [type, setType] = useState<CodexType>(initial?.type ?? 'character');
  const [name, setName] = useState(initial?.name ?? '');
  const [aliases, setAliases] = useState(initial?.aliases.join(', ') ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    const fields: CodexFields = { type, name, aliases: aliases.split(/[,，]/), summary };
    try {
      if (edit) await saveCodexEntry(edit, fields); else await createCodexEntry(scope, fields);
      onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const control = 'mt-1 w-full rounded border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1.5 text-[var(--text-normal)]';
  return <form aria-label={edit ? '编辑 Codex 条目' : '新建 Codex 条目'} onSubmit={(event) => void submit(event)} className="space-y-3 p-3 text-[13px]">
    <label className="block">类型<select className={control} value={type} onChange={(event) => setType(event.target.value as CodexType)} disabled={busy}>
      {Object.entries(CODEX_TYPE_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></label>
    <label className="block">名称<input className={control} value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} disabled={busy} /></label>
    <label className="block">别名<input className={control} value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="多个别名用逗号分隔" disabled={busy} /></label>
    <label className="block">概要<textarea className={control} value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} maxLength={4000} disabled={busy} /></label>
    {error && <p role="alert" className="text-[var(--color-error)]">{error}</p>}
    <div className="flex gap-2"><button type="submit" disabled={busy || !name.trim()} className="rounded border px-2 py-1 disabled:opacity-50">{busy ? '正在保存…' : edit ? '保存条目' : '创建条目'}</button>
      <button type="button" disabled={busy} onClick={onClose}>取消</button></div>
  </form>;
}
