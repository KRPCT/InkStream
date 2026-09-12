import { flushAutosave } from '../stores/autosave';
import { confirmDestructive } from '../stores/useConfirmStore';
import { useEditorStore } from '../stores/useEditorStore';
import { showToast } from '../stores/useToastStore';
import { queueAfterComposition } from './composition';
import { isDraftPath } from './draftPath';
import { releaseDocumentState } from './editorState';
import { getView } from './viewHandle';

const closing = new Map<string, Promise<boolean>>();

/** Closing owns save admission and release; UI callers never guess from a fulfilled Promise. */
export function closeDocument(path: string): Promise<boolean> {
  const pending = closing.get(path);
  if (pending) return pending;
  const operation = closeOnce(path).catch(() => {
    showToast('error', '无法完成关闭，文档仍保留在编辑器中。');
    return false;
  });
  closing.set(path, operation);
  void operation.finally(() => { if (closing.get(path) === operation) closing.delete(path); });
  return operation;
}

async function closeOnce(path: string): Promise<boolean> {
  const tab = useEditorStore.getState().tabs.find((t) => t.path === path);
  if (!tab) return true;
  const draft = isDraftPath(path);
  if (draft && useEditorStore.getState().dirty[path]) {
    const discard = await confirmDestructive({
      title: '放弃草稿', body: `「${tab.name}」尚未保存，关闭将丢弃全部内容。可先按 Ctrl+S 另存为文件。`, confirmLabel: '放弃草稿',
    });
    if (!discard) return false;
  } else if (!draft) {
    const outcome = await flushAutosave(path);
    if (outcome.kind !== 'saved') {
      if (outcome.kind !== 'failed') showToast('warning', '文档尚未保存，已保留标签。请先完成保存或处理外部冲突。');
      return false;
    }
  }
  return new Promise<boolean>((resolve) => {
    const release = async () => {
      const state = useEditorStore.getState();
      if (state.tabs.find((t) => t.path === path) !== tab || (!draft && state.dirty[path])) return resolve(false);
      try { resolve(await releaseDocumentState(path, draft)); } catch { resolve(false); }
    };
    const view = getView();
    if (view) queueAfterComposition(view, 'close:' + path, release);
    else release();
  });
}
