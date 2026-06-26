import { readFile } from '../../ipc/files';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { getDocForPath } from '../editorState';
import { applyRangeEdits } from './multibufferWrite';

/**
 * 摘录行内编辑回写（#2c 增量 2，数据安全核心）。
 *
 * 全库搜索结果里一段摘录被行内改写后，把新文本回写到源文件对应区间。**乐观并发**：以「编辑入口时
 * 的摘录原文」originalText 为期望旧值——
 * - 期望落点 [sourceFrom, sourceFrom+len) 仍等于 originalText → 原位回写（最常见，搜索后未变）；
 * - 落点不符（文件在搜索后被改、偏移漂移）但 originalText 在真相源中**唯一**出现 → 按内容重锚到该处；
 * - 不在 / 多处歧义 → 'moved' 拒写，绝不按陈旧偏移覆盖（对齐 replace-all 的 truth-source 纪律）。
 * 冲突中文件（frozen / externalChanged）跳过（CR-03）。回写收口到 applyRangeEdits 共享缓冲底座
 * （IME 安全 + 打开缓冲/磁盘路由 + undo 保留，CR-01）。
 */

export type ExcerptCommitResult = 'applied' | 'unchanged' | 'skipped' | 'moved' | 'failed';

export async function commitExcerptEdit(
  path: string,
  sourceFrom: number,
  originalText: string,
  newText: string,
): Promise<ExcerptCommitResult> {
  if (newText === originalText) return 'unchanged'; // 无改动：不写、不刷新。
  const root = useVaultStore.getState().vault?.root ?? null;
  if (root === null) return 'failed';
  const { frozen, externalChanged } = useEditorStore.getState();
  if (frozen[path] || externalChanged[path]) return 'skipped'; // 冲突中：不覆盖未和解的外部变更。
  const truth = getDocForPath(path) ?? (await readFile(root, path).catch(() => null));
  if (truth === null) return 'failed';
  const range = locateRange(truth, sourceFrom, originalText);
  if (range === null) return 'moved'; // 原文已变/歧义：拒写。
  const ok = await applyRangeEdits(path, truth, [{ from: range.from, to: range.to, insert: newText }]);
  return ok ? 'applied' : 'failed';
}

/**
 * 定位回写区间：期望落点 [from, from+len) 等于 originalText 则原位用之；否则真相源中**唯一**出现才重锚；
 * 零处 / 多处（歧义）一律返 null（拒写）。空原文不可锚（避免在任意位置插入）。
 */
function locateRange(
  truth: string,
  sourceFrom: number,
  originalText: string,
): { from: number; to: number } | null {
  const len = originalText.length;
  if (truth.slice(sourceFrom, sourceFrom + len) === originalText) {
    return { from: sourceFrom, to: sourceFrom + len };
  }
  if (originalText === '') return null;
  const first = truth.indexOf(originalText);
  if (first === -1) return null;
  if (truth.indexOf(originalText, first + 1) !== -1) return null; // 多处歧义。
  return { from: first, to: first + len };
}
