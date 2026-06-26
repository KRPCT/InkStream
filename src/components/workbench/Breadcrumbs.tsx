import { ChevronRight } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { activeHeadingPath, scrollToHeading } from '../../editor/outline';
import { useEditorStore } from '../../stores/useEditorStore';
import { useOutlineStore } from '../../stores/useOutlineStore';

/**
 * 面包屑栏（v1.2 #2b，对标 Zed）：编辑器顶部显示光标所在的标题路径（H1 › H2 › …），点击任一段跳到该标题。
 *
 * 反应式推导：订阅 cursor（CM updateListener 单向镜像）+ items（大纲镜像），经纯函数 activeHeadingPath
 * 算路径——无需另开镜像通道。光标在首个标题之前 / 无活动文档 / 无标题时整条自隐（不占布局、不扰空态）。
 * 跳转复用 outline.scrollToHeading（#17 真实滚动容器 + 不抢焦点，IME 纪律）。
 */
export default function Breadcrumbs() {
  const items = useOutlineStore((s) => s.items);
  const cursor = useEditorStore((s) => s.cursor);
  const activePath = useEditorStore((s) => s.activePath);
  // cursor 是最高频 store 字段（每次移动/击键都变）；缓存路径推导，避免无关重渲染时的重复扫描。
  const path = useMemo(() => activeHeadingPath(items, cursor), [items, cursor]);
  if (!activePath || path.length === 0) return null;
  return (
    <nav
      aria-label="标题路径"
      className="flex h-7 flex-none items-center gap-0.5 overflow-x-auto whitespace-nowrap border-b border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 text-[12px]"
    >
      {path.map((h, i) => (
        <Fragment key={h.from}>
          {i > 0 && (
            <ChevronRight size={12} className="flex-none text-[var(--text-faint)]" aria-hidden />
          )}
          <button
            type="button"
            onClick={() => scrollToHeading(h.from)}
            title={h.text}
            aria-current={i === path.length - 1 ? 'location' : undefined}
            className={`flex-none truncate rounded-[3px] px-1 py-0.5 hover:bg-[var(--background-modifier-hover)] ${
              i === path.length - 1 ? 'text-[var(--text-normal)]' : 'text-[var(--text-muted)]'
            }`}
          >
            {h.text || '（无标题）'}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
