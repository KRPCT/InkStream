import type { EditorView } from '@codemirror/view';
import { getView } from '../viewHandle';
import { nextLanguage, readLanguage, writeLanguage } from '../frontmatter';

/**
 * 「文档：切换文档语言」命令实现（D-13）。
 *
 * 读当前 doc 的 frontmatter language → 取下一档（markdown→latex→typst→richtext 循环）
 * → writeLanguage 经 CM transaction 改 doc（frontmatter 为语言真相源）。
 *
 * 语言热切由 useCodeMirror 的 updateListener 在本次 docChanged 时经
 * reconfigureLanguageFromDoc 触发——命令只负责把 frontmatter 写对，不直接 reconfigure，
 * 与「用户手动编辑 frontmatter」走同一条收口路径（单一真相源，避免双写漂移）。
 *
 * 无 view（编辑器未挂载）时静默返回。返回新的目标语言（供测试断言/调用方提示）。
 */
export function cycleDocumentLanguage(view: EditorView | null = getView()): string | null {
  if (!view) return null;
  const doc = view.state.doc.toString();
  const target = nextLanguage(readLanguage(doc));
  const next = writeLanguage(doc, target);
  if (next === doc) return target;
  // 整文替换：changes 覆盖 [0, len)。frontmatter 写入是头部小改，但用整体 setText
  // 语义最简单且不需精确 diff——doc 由命令一次性原子改写。
  view.dispatch({
    changes: { from: 0, to: doc.length, insert: next },
  });
  return target;
}
