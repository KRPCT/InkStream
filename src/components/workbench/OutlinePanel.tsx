import { ListTree } from 'lucide-react';
import { useEffect } from 'react';
import { scrollToHeading, syncOutline } from '../../editor/outline';
import { getView } from '../../editor/viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import { useOutlineStore } from '../../stores/useOutlineStore';
import EmptyState from '../common/EmptyState';

/**
 * 大纲面板（RightPanel 大纲 tab）：列活动文档的 H1-H6 标题，按级别缩进，点击滚到该标题。
 * 数据来自 useOutlineStore（editor/outline.ts 单向镜像）。空 → 沿用逐 tab 空态文案。
 */
export default function OutlinePanel() {
  const items = useOutlineStore((s) => s.items);
  const activePath = useEditorStore((s) => s.activePath);

  // 换装入口（openFile/switchToTab）与 docChanged 已同步大纲；此处兜底面板首次挂载 / HMR / 切文件时的新鲜度。
  useEffect(() => {
    const view = getView();
    if (view) syncOutline(view);
  }, [activePath]);

  if (items.length === 0) {
    return <EmptyState icon={ListTree} heading="暂无大纲" body="打开文档后，标题结构会显示在这里。" />;
  }

  return (
    <div className="h-full overflow-auto py-1">
      {items.map((item, i) => (
        <button
          key={`${item.from}-${i}`}
          type="button"
          onClick={() => scrollToHeading(item.from)}
          title={item.text}
          className="block w-full truncate rounded-[4px] py-1 pr-3 text-left text-[13px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
          style={{ paddingLeft: `${(item.level - 1) * 12 + 12}px` }}
        >
          {item.text || '（无标题）'}
        </button>
      ))}
    </div>
  );
}
