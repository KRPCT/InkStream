import type { EditorView } from '@codemirror/view';
import { useSceneSummaryStore } from '../stores/useSceneSummaryStore';
import { readFields } from './frontmatter';
import { isBasicEditing } from './documentBudget';
import { useEditorStore } from '../stores/useEditorStore';
import type { SceneStatus } from '../types/creative';

/**
 * 场景概要镜像（CREA-05）：活动文档 frontmatter `summary:`（单行）→ store。无则空串。
 * 与 outline/citations 同纪律：换装入口 + docChanged（mirrorListener）调用，change-guard，store 永不回写 CM。
 */

export function extractSceneSummary(doc: string): string {
  return readFields(doc, ['summary']).summary ?? '';
}

export function syncSceneSummary(view: EditorView): void {
  const paused = isBasicEditing(view.state);
  const text = paused ? '' : view.state.doc.toString();
  const summary = paused ? '' : extractSceneSummary(text);
  const raw = readFields(text, ['status']).status ?? 'draft';
  const status = paused || !['draft', 'revised', 'final'].includes(raw) ? null : raw as SceneStatus;
  const sourcePath = useEditorStore.getState().activePath;
  const before = useSceneSummaryStore.getState();
  if (before.summary !== summary || before.status !== status || before.sourcePath !== sourcePath)
    useSceneSummaryStore.setState({ summary, status, sourcePath });
}
