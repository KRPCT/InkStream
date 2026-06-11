import { flushAutosave } from '../stores/autosave';
import { useEditorStore } from '../stores/useEditorStore';

/**
 * Ctrl+S 立即落盘当前活动文件（取消防抖定时器并原子写，D-02）。
 *
 * 无活动文件时 no-op。落盘逻辑收口 autosave.flushAutosave（含自激抑制 + 失败保留脏态 + 错误 toast）。
 */
export async function flushActiveFile(): Promise<void> {
  const active = useEditorStore.getState().activePath;
  if (!active) return;
  await flushAutosave(active);
}
