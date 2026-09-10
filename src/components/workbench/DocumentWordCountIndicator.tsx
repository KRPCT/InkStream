import { useEditorStore } from '../../stores/useEditorStore';
import { useWordCountStore } from '../../stores/useWordCountStore';

export default function DocumentWordCountIndicator() {
  const active = useEditorStore((state) => state.activePath);
  const count = useWordCountStore((state) => state.activeCount);
  const selected = useWordCountStore((state) => state.selectedCount);
  const hasSelection = useWordCountStore((state) => state.hasSelection);
  if (!active) return null;
  const text = count === null ? '字数统计已暂停' : hasSelection
    ? `已选 ${selected === null ? '未统计' : selected} / 正文 ${count} 字` : `正文 ${count} 字`;
  return <span data-testid="document-word-count" className="flex h-full items-center border-l border-[var(--background-modifier-border)] px-2" title="中文字符逐字计数，英文等连续词为一字；正文统计不含 frontmatter。">{text}</span>;
}
