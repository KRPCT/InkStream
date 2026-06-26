import { flushAutosave, writeProjectFile } from '../../stores/autosave';
import { useEditorStore } from '../../stores/useEditorStore';
import { isComposing, queueAfterComposition } from '../composition';
import { applyEditsToOpenDoc } from '../editorState';
import { getView } from '../viewHandle';

/**
 * multibuffer 回写底座（#2c replace-all 与行内摘录编辑共用，数据安全单一真相源）。
 *
 * 把一组**互不重叠**的区间编辑收口到与主编辑器**同一份** per-path 缓冲：
 * - 活动文件组合期：dispatch 会撕 IME 锚定 → 吞字（铁律 2），整笔 {dispatch + markDirty + flush} 经
 *   queueAfterComposition 推迟到 compositionend，按入队序去重；
 * - 已打开（活动 / 后台）：applyEditsToOpenDoc 改 EditorState（保 undo）+ flushAutosave 串行落盘；
 * - 未打开：writeProjectFile 直写磁盘（不经 flushAutosave，否则按 getDocForPath→null 写空串）。
 * 杜绝 multibuffer 另持文件副本造成的双真相源 clobber（CR-01）。冲突态（frozen/external）判定由调用方
 * 在取真相源前完成（CR-03），此层只管「写到正确缓冲 + IME 安全」。
 */

export interface RangeEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * 把区间编辑写回某 path（打开缓冲 / 磁盘），活动文件组合期推迟。返回是否落在「打开缓冲或成功落盘」。
 * diskContent 仅未打开文件落盘分支用（在其上算最终内容）。
 */
export async function applyRangeEdits(
  path: string,
  diskContent: string,
  edits: RangeEdit[],
): Promise<boolean> {
  if (edits.length === 0) return true;
  const view = getView();
  if (view && isComposing(view) && useEditorStore.getState().activePath === path) {
    // 组合期推迟到 compositionend drain。偏移按调用方此刻的 view 真相源算成；组合期间 doc 可能位移，
    // 故捕获各区间「期望旧值」，drain 时逐条核对仍在原偏移、未越界——任一不符即整体放弃（宁可不写，
    // 绝不按陈旧偏移错位写，数据安全优先；对齐 commitSub「drain 时按 live 重解析」纪律，RULE 4）。
    const expected = edits.map((e) => view.state.doc.sliceString(e.from, e.to));
    queueAfterComposition(view, 'mb-write:' + path, () => {
      const doc = view.state.doc;
      const intact = edits.every((e, i) => e.to <= doc.length && doc.sliceString(e.from, e.to) === expected[i]);
      if (!intact) return; // 组合期 doc 已变：放弃这笔回写，避免错位覆盖。
      view.dispatch({ changes: edits });
      useEditorStore.getState().markDirty(path);
      void flushAutosave(path);
    });
    return true;
  }
  if (applyEditsToOpenDoc(path, edits)) {
    // 活动文件 dispatch 由 mirrorListener markDirty；后台缓存更新无监听，统一在此补 markDirty。
    useEditorStore.getState().markDirty(path);
    await flushAutosave(path);
    return true;
  }
  return writeProjectFile(path, applyEditsToString(diskContent, edits));
}

/** 自后向前把区间编辑应用到字符串（互不重叠前提，免前序替换移位后序偏移）。 */
export function applyEditsToString(content: string, edits: RangeEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.from - b.from);
  let out = content;
  for (let i = sorted.length - 1; i >= 0; i--) {
    out = out.slice(0, sorted[i].from) + sorted[i].insert + out.slice(sorted[i].to);
  }
  return out;
}
