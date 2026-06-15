import type { EditorView } from '@codemirror/view';
import { useSceneSummaryStore } from '../stores/useSceneSummaryStore';
import { readFields } from './frontmatter';

/**
 * 场景概要镜像（CREA-05）：活动文档 frontmatter `summary:`（单行）→ store。无则空串。
 * 与 outline/citations 同纪律：换装入口 + docChanged（mirrorListener）调用，change-guard，store 永不回写 CM。
 */

export function extractSceneSummary(doc: string): string {
  return readFields(doc, ['summary']).summary ?? '';
}

export function syncSceneSummary(view: EditorView): void {
  const summary = extractSceneSummary(view.state.doc.toString());
  if (useSceneSummaryStore.getState().summary !== summary) {
    useSceneSummaryStore.getState().setSummary(summary);
  }
}
