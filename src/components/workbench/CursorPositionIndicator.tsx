import { getView } from '../../editor/viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';

/**
 * StatusBar 右侧光标位置指示（SHELL-02）：行:列（1 基）。
 * cursor 镜像存的是文档 offset（useEditorStore），经单内核 doc.lineAt 转 line:col。
 * 无活动文件 / 无编辑器实例时隐藏（jsdom / 空态）。订阅 cursor 单字段，重渲仅本指示器、不触编辑器。
 */
export default function CursorPositionIndicator() {
  const cursor = useEditorStore((s) => s.cursor);
  const activePath = useEditorStore((s) => s.activePath);
  if (!activePath) return null;
  const view = getView();
  if (!view) return null;
  const doc = view.state.doc;
  const pos = Math.max(0, Math.min(cursor, doc.length));
  const line = doc.lineAt(pos);
  return (
    <span
      data-testid="cursor-position-indicator"
      className="flex h-full items-center px-2 text-[12px] tabular-nums text-[var(--text-muted)]"
    >
      行 {line.number}, 列 {pos - line.from + 1}
    </span>
  );
}
