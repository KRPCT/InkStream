import { ListTree } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isComposing, queueAfterComposition } from '../../editor/composition';
import { activeHeadingFrom, extractOutline, sameOutline, scrollToHeading, syncOutline } from '../../editor/outline';
import { computeSectionMove, sectionRanges } from '../../editor/outlineMove';
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
 *
 * 拖拽重排（#2d）：拖一个标题到另一标题之前 / 末尾投放区，整节（含其下级，尊重语法树块边界）随之移动。
 * 移动落实为对主 doc 的一次 dispatch（computeSectionMove 算删源+插目标），偏移在写时按 live 状态重算（不信
 * 可能陈旧的 store items），组合期按铁律 2 推迟。doc 变更经 mirrorListener 触发 syncOutline，面板自然刷新。
 */
export default function OutlinePanel() {
  const items = useOutlineStore((s) => s.items);
  const activePath = useEditorStore((s) => s.activePath);
  const cursor = useEditorStore((s) => s.cursor);
  const panelTab = useWorkbenchStore((s) => s.activeTab);
  const activeFrom = useMemo(() => activeHeadingFrom(items, cursor), [items, cursor]);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  /** 把 fromIndex 节移到 toIndex 之前（toIndex===items.length 即文末）。在 live 状态上重算偏移并 dispatch。 */
  const performMove = (fromIndex: number, toIndex: number): void => {
    const view = getView();
    if (!view) return;
    const live = extractOutline(view.state);
    // 拖拽索引取自渲染快照 items；若 live 大纲与之已不一致（位置/级别/文本任一变化，非仅条数），陈旧索引会指向
    // 不同的节 → 静默错位移动。逐项核对一致才动手（length 相等不足以证明索引仍对应同一节）。
    if (!sameOutline(live, items)) return;
    const move = computeSectionMove(view.state.doc.toString(), live, fromIndex, toIndex);
    if (move === null) return;
    const run = (): void =>
      void view.dispatch({
        changes: move.changes,
        selection: { anchor: move.caret },
        userEvent: 'move.section',
        scrollIntoView: true,
      });
    if (isComposing(view)) queueAfterComposition(view, 'outline-move', run);
    else run();
  };

  const endDrag = (): void => {
    setDragIndex(null);
    setDropIndex(null);
  };

  // 落点是否「不会真的移动」（落在自身节区间内含两端：拖到自身/子树内、或紧邻同位）。用 store items + doc 长度
  // 廉价判定（不切 doc 字符串），与 computeSectionMove 的 null 守卫同口径——据此对无效落点不显投放指示线。
  const isNoopDrop = (toIndex: number): boolean => {
    if (dragIndex === null) return true;
    const docLen = getView()?.state.doc.length ?? 0;
    const ranges = sectionRanges(items, docLen);
    const src = ranges[dragIndex];
    if (!src) return true;
    const dest = toIndex < items.length ? items[toIndex].from : docLen;
    return dest >= src.from && dest <= src.to;
  };
  const dropNoop = dragIndex !== null && dropIndex !== null ? isNoopDrop(dropIndex) : false;

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
        const isDropTarget = dragIndex !== null && dragIndex !== i && dropIndex === i && !dropNoop;
        return (
          <button
            key={`${item.from}-${i}`}
            ref={active ? activeRef : undefined}
            type="button"
            draggable
            onDragStart={(e) => {
              setDragIndex(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i)); // 部分平台需 setData 才发起拖拽。
            }}
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) performMove(dragIndex, i);
              endDrag();
            }}
            onDragEnd={endDrag}
            onClick={() => scrollToHeading(item.from)}
            title={item.text}
            aria-current={active ? 'location' : undefined}
            className={`block w-full truncate rounded-[4px] py-1 pr-3 text-left text-[13px] hover:bg-[var(--background-modifier-hover)] ${
              isDropTarget ? 'border-t-2 border-[var(--accent)]' : ''
            } ${
              active
                ? 'bg-[var(--background-modifier-hover)] text-[var(--text-normal)]'
                : 'text-[var(--text-normal)]'
            } ${dragIndex === i ? 'opacity-50' : ''}`}
            style={{ paddingLeft: `${(item.level - 1) * 12 + 12}px` }}
          >
            {item.text || '（无标题）'}
          </button>
        );
      })}
      {/* 末尾投放区：拖到此处把整节移到文末。 */}
      <div
        onDragOver={(e) => {
          if (dragIndex === null) return;
          e.preventDefault();
          setDropIndex(items.length);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragIndex !== null) performMove(dragIndex, items.length);
          endDrag();
        }}
        aria-hidden
        className={`mx-2 h-3 rounded ${
          dragIndex !== null && dropIndex === items.length && !dropNoop
            ? 'border-t-2 border-[var(--accent)]'
            : ''
        }`}
      />
    </div>
  );
}
