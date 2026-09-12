import { ExternalLink, X } from 'lucide-react';
import { useRef } from 'react';
import { closeDocument } from '../../editor/documentSession';
import { switchToTab } from '../../editor/editorState';
import { useEditorStore } from '../../stores/useEditorStore';

/**
 * 编辑器 tab 栏（D-01 标签页模型）：tab 并存、可关闭、带脏标记。
 *
 * 切 tab 经 switchToTab(path)——单内核 view.setState 换装 + 快照 + 滚动还原（D-03）全在
 * editorState 内完成，组件不重复实现。关闭统一交给 documentSession 保存并释放。
 * 高 36 / 内边距 12 / active 2px 底 accent 指示条 + 600 字重；脏态圆点在 hover / focus-within 时变 x。
 */

/**
 * 关 tab：先 await flush 落盘（CR-02 必须等落盘完成再释放，否则在途写落到已 dispose 的
 * state / 已切换的活动 tab，叠加 CR-01 会把错误内容写入本文件）→ 释放 state/滚动缓存 → store 移除。
 * Ctrl+W 同路。保存失败或存在新修订时保留脏态、编辑内容和标签。
 *
 * 草稿（draft://）无落盘路径：脏草稿先弹丢弃确认（取消则保留），确认/干净直接释放——不 flush。
 */
const closeTabFlow = closeDocument;

export default function EditorTabs() {
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const dirty = useEditorStore((s) => s.dirty);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const tabbablePath = tabs.some((tab) => tab.path === activePath) ? activePath : tabs[0]?.path;

  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="已打开的文档"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-[var(--background-modifier-border)] bg-[var(--background-secondary)]"
    >
      {tabs.map((tab, index) => {
        const active = tab.path === activePath;
        const isDirty = dirty[tab.path] === true;
        return (
          <div
            key={tab.path}
            ref={(element) => {
              if (element) tabRefs.current.set(tab.path, element);
              else tabRefs.current.delete(tab.path);
            }}
            role="tab"
            aria-selected={active}
            tabIndex={tab.path === tabbablePath ? 0 : -1}
            onClick={(e) => {
              e.currentTarget.focus();
              void switchToTab(tab.path);
            }}
            onKeyDown={(e) => {
              // 关闭按钮保留原生键盘行为，不让冒泡事件变成标签切换。
              if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
              let nextIndex: number;
              switch (e.key) {
                case 'ArrowLeft':
                  nextIndex = (index - 1 + tabs.length) % tabs.length;
                  break;
                case 'ArrowRight':
                  nextIndex = (index + 1) % tabs.length;
                  break;
                case 'Home':
                  nextIndex = 0;
                  break;
                case 'End':
                  nextIndex = tabs.length - 1;
                  break;
                case 'Enter':
                case ' ':
                  nextIndex = index;
                  break;
                default:
                  return;
              }
              e.preventDefault();
              const nextTab = tabs[nextIndex];
              tabRefs.current.get(nextTab.path)?.focus();
              void switchToTab(nextTab.path);
            }}
            className={
              'group flex shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 text-[13px] ' +
              (active
                ? 'border-[var(--accent)] bg-[var(--background-primary)] font-semibold text-[var(--text-normal)]'
                : 'border-transparent font-normal text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]')
            }
          >
            {/* #5.2：库外（非工作区）文件标记——ExternalLink 图标 + 斜体名 + tooltip。 */}
            {tab.external ? (
              <ExternalLink
                size={11}
                strokeWidth={1.75}
                aria-label="非工作区文件"
                className="shrink-0 text-[var(--text-faint)]"
              />
            ) : null}
            <span
              className={'whitespace-nowrap' + (tab.external ? ' italic' : '')}
              title={tab.external ? `非工作区文件：${tab.path}` : undefined}
            >
              {tab.name}
            </span>
            {/* 鼠标悬停或键盘焦点进入标签时，脏圆点让位给可操作的关闭按钮。 */}
            {isDirty ? (
              <span
                data-testid={`dirty-dot-${tab.path}`}
                aria-label="未保存"
                className="h-1.5 w-1.5 rounded-full bg-[var(--text-muted)] group-hover:hidden group-focus-within:hidden"
              />
            ) : null}
            <button
              type="button"
              data-testid={`close-tab-${tab.path}`}
              aria-label={`关闭 ${tab.name}`}
              tabIndex={tab.path === tabbablePath ? 0 : -1}
              onClick={(e) => {
                e.stopPropagation();
                void closeTabFlow(tab.path);
              }}
              className={
                'h-4 w-4 items-center justify-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] ' +
                (isDirty
                  ? 'hidden group-hover:flex group-focus-within:flex'
                  : 'flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')
              }
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
