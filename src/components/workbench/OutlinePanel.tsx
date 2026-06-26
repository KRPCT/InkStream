import { ListTree } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { activeHeadingFrom, scrollToHeading, syncOutline } from '../../editor/outline';
import { getView } from '../../editor/viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import { useOutlineStore } from '../../stores/useOutlineStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import EmptyState from '../common/EmptyState';

/**
 * 大纲面板（RightPanel 大纲 tab）：列活动文档的 H1-H6 标题，按级别缩进，点击滚到该标题。
 * 数据来自 useOutlineStore（editor/outline.ts 单向镜像）。空 → 沿用逐 tab 空态文案。
 *
 * 双向同步（#2b）：editor→outline——订阅 cursor，高亮光标所在标题并把它滚入面板可视区（block:nearest，
 * 仅滚面板自身溢出容器，不碰编辑器/不抢焦点）；outline→editor——点击行 scrollToHeading（既有）。
 */
export default function OutlinePanel() {
  const items = useOutlineStore((s) => s.items);
  const activePath = useEditorStore((s) => s.activePath);
  const cursor = useEditorStore((s) => s.cursor);
  const panelTab = useWorkbenchStore((s) => s.activeTab);
  const activeFrom = useMemo(() => activeHeadingFrom(items, cursor), [items, cursor]);
  const activeRef = useRef<HTMLButtonElement>(null);

  // 换装入口（openFile/switchToTab）与 docChanged 已同步大纲；此处兜底面板首次挂载 / HMR / 切文件时的新鲜度。
  useEffect(() => {
    const view = getView();
    if (view) syncOutline(view);
  }, [activePath]);

  // 活动标题变化（或大纲 tab 刚切为可见）时把其行滚入面板可视区。RightPanel 用 display:none 保活：tab 隐藏时
  // scrollIntoView 落在零布局子树上无效，故 panelTab 入依赖——切回大纲 tab 即补一次滚动（block:nearest 已在内则不动）。
  useEffect(() => {
    if (panelTab !== 'outline') return;
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeFrom, panelTab]);

  if (items.length === 0) {
    return <EmptyState icon={ListTree} heading="暂无大纲" body="打开文档后，标题结构会显示在这里。" />;
  }

  return (
    <div className="h-full overflow-auto py-1">
      {items.map((item, i) => {
        const active = item.from === activeFrom;
        return (
          <button
            key={`${item.from}-${i}`}
            ref={active ? activeRef : undefined}
            type="button"
            onClick={() => scrollToHeading(item.from)}
            title={item.text}
            aria-current={active ? 'location' : undefined}
            className={`block w-full truncate rounded-[4px] py-1 pr-3 text-left text-[13px] hover:bg-[var(--background-modifier-hover)] ${
              active
                ? 'bg-[var(--background-modifier-hover)] text-[var(--text-normal)]'
                : 'text-[var(--text-normal)]'
            }`}
            style={{ paddingLeft: `${(item.level - 1) * 12 + 12}px` }}
          >
            {item.text || '（无标题）'}
          </button>
        );
      })}
    </div>
  );
}
