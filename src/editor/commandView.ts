import type { EditorView } from '@codemirror/view';
import { useEditorStore } from '../stores/useEditorStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { effectiveCentralView } from '../stores/effectiveCentralView';
import { queueAfterComposition } from './composition';
import { currentDocumentNavigation, documentNavigationSignal, isCurrentDocumentNavigation } from './editorState.navigation';
import { getView } from './viewHandle';
import { projectBlocksEditing, useProjectStore } from '../stores/useProjectStore';

// The document view stays mounted for persistence. Commands have a narrower lifetime:
// leaving the editor retires an intent even when the same document is later shown again.
let presentation = new AbortController();
let commandSequence = 0;
function retirePresentation(): void {
  presentation.abort();
  presentation = new AbortController();
}
const unsubscribeWorkbench = useWorkbenchStore.subscribe((state, previous) => {
  if (state.centralView !== previous.centralView) retirePresentation();
});
const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
  if (state.simpleMode !== previous.simpleMode || state.bookshelfEnabled !== previous.bookshelfEnabled) retirePresentation();
});
const unsubscribeProjects = useProjectStore.subscribe((state, previous) => {
  if (state.archiveOpen !== previous.archiveOpen || state.phase !== previous.phase || state.activeId !== previous.activeId) retirePresentation();
});
if (import.meta.hot) import.meta.hot.dispose(() => { unsubscribeWorkbench(); unsubscribeSettings(); unsubscribeProjects(); });

export function getCommandView(): EditorView | null {
  if (projectBlocksEditing()) return null;
  const { centralView } = useWorkbenchStore.getState();
  const { simpleMode, bookshelfEnabled } = useSettingsStore.getState();
  return effectiveCentralView(centralView, { simpleMode, bookshelfEnabled }) === 'editor' ? getView() : null;
}

export function getWritableCommandView(): EditorView | null {
  const view = getCommandView();
  return view && !view.state.readOnly ? view : null;
}

export interface CommandIntent {
  view: EditorView;
  signal: AbortSignal;
  isCurrent: () => boolean;
}

/** Capture before awaiting a picker, clipboard, compiler, or composition boundary. */
export function captureCommandIntent(view: EditorView, trackSelection = true): CommandIntent {
  const signal = presentation.signal;
  const navigation = currentDocumentNavigation();
  const { activePath: path, tabs } = useEditorStore.getState();
  const tab = tabs.find((item) => item.path === path);
  const vault = useVaultStore.getState().vault;
  const { doc, selection } = view.state;
  return {
    view,
    signal,
    isCurrent: () => !signal.aborted && isCurrentDocumentNavigation(navigation) &&
      getCommandView() === view && useVaultStore.getState().vault === vault &&
      useEditorStore.getState().activePath === path &&
      useEditorStore.getState().tabs.find((item) => item.path === path) === tab &&
      view.state.doc === doc && (!trackSelection || view.state.selection.eq(selection)),
  };
}

export function applyCommandIntent(intent: CommandIntent, action: (view: EditorView) => void): Promise<void> {
  if (!intent.isCurrent()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const signals = [intent.signal, documentNavigationSignal(currentDocumentNavigation())];
    let settled = false;
    const cleanup = () => {
      settled = true;
      for (const signal of signals) signal.removeEventListener('abort', abandon);
    };
    const abandon = () => { cleanup(); resolve(); };
    for (const signal of signals) signal.addEventListener('abort', abandon, { once: true });
    if (signals.some((signal) => signal.aborted)) { abandon(); return; }
    queueAfterComposition(intent.view, `editor-command:${++commandSequence}`, () => {
      if (settled) return;
      try {
        if (intent.isCurrent() && getWritableCommandView() === intent.view) action(intent.view);
        cleanup();
        resolve();
      } catch (error) { cleanup(); reject(error); }
    });
  });
}

export function runWritableCommand(action: (view: EditorView) => void): void {
  const view = getWritableCommandView();
  if (view) void applyCommandIntent(captureCommandIntent(view), action);
}
