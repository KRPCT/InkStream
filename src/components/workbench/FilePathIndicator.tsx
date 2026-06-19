import { useEditorStore } from '../../stores/useEditorStore';

/**
 * StatusBar 左侧文件路径指示（SHELL-02）：活动文件的 key（库内=相对路径 / 库外=绝对路径 / 草稿=draft://N）。
 * 无活动文件隐藏。长路径截断，完整值见 title。文本走中性层，无强调色。
 */
export default function FilePathIndicator() {
  const activePath = useEditorStore((s) => s.activePath);
  if (!activePath) return null;
  return (
    <span
      data-testid="file-path-indicator"
      title={activePath}
      className="flex h-full min-w-0 items-center px-2 text-[12px] text-[var(--text-muted)]"
    >
      <span className="max-w-[420px] truncate">{activePath}</span>
    </span>
  );
}
