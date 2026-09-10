import { createDir, readFile } from '../ipc/files';
import { createCodexFile } from '../ipc/codex';
import { listDir } from '../ipc/vault';
import { useCodexStore } from '../stores/useCodexStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { VaultInfo } from '../types/vault';
import { refreshCodex } from './codex';
import { parseCodexEntry, updateCodexMetadata, validateCodexFields, type CodexFields } from './codexMetadata';
import { serializeDocumentTransition } from './documentTransitions';
import { getDocForPath } from './editorState';
import { refreshTree } from './fileTreeData';
import { applyRangeEdits } from './multibuffer/multibufferWrite';

export interface CodexEdit { scope: VaultInfo; path: string; original: string; fields: CodexFields }
function assertScope(scope: VaultInfo): void {
  if (useVaultStore.getState().vault !== scope) throw new Error('工作区已切换，请在当前工作区重新打开条目。');
}

function assertUnique(fields: CodexFields, exceptPath?: string): void {
  const names = new Set([fields.name, ...fields.aliases].map((text) => text.normalize('NFC')));
  const other = useCodexStore.getState().entries.find((entry) => entry.path !== exceptPath &&
    [entry.name, ...entry.aliases].some((text) => names.has(text.normalize('NFC'))));
  if (other) throw new Error(`名称或别名与「${other.name}」重复，请使用不同名称。`);
}

export async function loadCodexEdit(scope: VaultInfo, path: string): Promise<CodexEdit> {
  assertScope(scope);
  const original = getDocForPath(path) ?? await readFile(scope.root, path);
  assertScope(scope);
  return { scope, path, original, fields: parseCodexEntry(path, original) };
}

export function createCodexEntry(scope: VaultInfo, input: CodexFields): Promise<string> {
  const fields = validateCodexFields(input);
  return serializeDocumentTransition(async () => {
    assertScope(scope);
    await refreshCodex(scope.root);
    assertScope(scope);
    if (useCodexStore.getState().status === 'error') throw new Error('读取条目失败，请重试后创建。');
    assertUnique(fields);
    const parent = await listDir(scope.root, '');
    const directory = parent.find((item) => item.name === 'Codex');
    if (directory && !directory.isDir) throw new Error('Codex 已是文件，无法在此创建条目。');
    if (!directory) await createDir(scope.root, 'Codex');
    assertScope(scope);
    // Identity stays stable when the display name changes; exclusive native creation rejects collisions.
    const stem = fields.name.replace(/[<>:"/\\|?*]/g, '_').replace(/[ .]+$/g, '') || '条目';
    const path = `Codex/${stem}-${crypto.randomUUID().slice(0, 8)}.md`;
    await createCodexFile(scope.root, path, updateCodexMetadata('\n', fields));
    await refreshCodex(scope.root);
    await refreshTree();
    return path;
  });
}

export function saveCodexEntry(edit: CodexEdit, input: CodexFields): Promise<void> {
  const fields = validateCodexFields(input);
  return serializeDocumentTransition(async () => {
    const { scope, path, original } = edit;
    assertScope(scope);
    await refreshCodex(scope.root);
    assertScope(scope);
    assertUnique(fields, path);
    const state = useEditorStore.getState();
    if (state.frozen[path] || state.externalChanged[path]) throw new Error('该条目存在外部修改冲突，请先在编辑器中处理。');
    const diskOrLive = getDocForPath(path) ?? await readFile(scope.root, path);
    assertScope(scope);
    const current = getDocForPath(path) ?? diskOrLive;
    if (current !== original) throw new Error('条目在编辑期间已改变，请重新打开编辑表单；当前正文已保留。');
    const next = updateCodexMetadata(current, fields);
    // Only replace the header, retaining body positions and editor history.
    let shared = 0;
    while (shared < current.length && shared < next.length && current[current.length - 1 - shared] === next[next.length - 1 - shared]) ++shared;
    const ok = await applyRangeEdits(path, current, [{ from: 0, to: current.length - shared, insert: next.slice(0, next.length - shared) }], scope);
    if (!ok) throw new Error('条目尚未保存成功；请保留此表单并检查编辑器中的内容。');
    await refreshCodex(scope.root);
  });
}
