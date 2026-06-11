import { Bold, Italic, Link, Underline, type LucideIcon } from 'lucide-react';
import { useEditorStore } from '../../stores/useEditorStore';
import { getView } from '../viewHandle';
import { insertLink, toggleBold, toggleItalic, wrapUnderline } from './commands';

/**
 * richtext 常驻细工具条（D-14 / UI-SPEC）：仅 `language: richtext` 活动文档显示。
 *
 * 几何：高 32px，背景 --background-secondary-alt，底部 1px 边框，左对齐按钮组（间距 8px）。
 * 四钮 B/I/U/链接（lucide，28x28 命中区、16px 图标），tooltip 含快捷键提示（D-16）。
 * 无 toggle 保持态（Phase 2 Source 模式纯插入/包裹语义，UI-SPEC）。
 *
 * 显隐源：useEditorStore.isRichtext（单向自 CM frontmatter language 镜像，editorState.syncRichtext）。
 * 按钮经 getView() 取单内核 EditorView 调 richtext/commands（EditorView 不进 store 纪律）。
 */

interface ToolButton {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly shortcut: string;
  readonly run: (view: Parameters<typeof toggleBold>[0]) => void;
}

const BUTTONS: readonly ToolButton[] = [
  { icon: Bold, label: '加粗', shortcut: 'Ctrl+B', run: toggleBold },
  { icon: Italic, label: '斜体', shortcut: 'Ctrl+I', run: toggleItalic },
  { icon: Underline, label: '下划线', shortcut: 'Ctrl+U', run: wrapUnderline },
  { icon: Link, label: '链接', shortcut: 'Ctrl+K', run: insertLink },
];

export default function Toolbar() {
  const isRichtext = useEditorStore((s) => s.isRichtext);
  if (!isRichtext) return null;

  const handle = (run: ToolButton['run']) => () => {
    const view = getView();
    if (view) run(view);
  };

  return (
    <div
      role="toolbar"
      aria-label="richtext 格式工具条"
      className="flex h-8 items-center gap-2 border-b border-[var(--background-modifier-border)] bg-[var(--background-secondary-alt)] px-2"
    >
      {BUTTONS.map(({ icon: Icon, label, shortcut, run }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={`${label}（${shortcut}）`}
          onClick={handle(run)}
          className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--text-muted)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--interactive-accent)]"
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}
