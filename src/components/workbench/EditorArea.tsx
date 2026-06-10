import Kbd from '../common/Kbd';

const SHORTCUT_HINTS = [
  { label: '打开命令面板', keys: 'Ctrl+Shift+P' },
  { label: '切换侧边栏', keys: 'Ctrl+B' },
  { label: '切换右侧面板', keys: 'Ctrl+Alt+B' },
];

/** EditorArea 欢迎页（UI-SPEC）：应用名 20/600 --text-faint + 24px 间距 + 三行 kbd 提示。 */
export default function EditorArea() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-[var(--background-primary)]">
      <p className="text-[20px] leading-[1.2] font-semibold text-[var(--text-faint)]">
        InkStream / 墨流
      </p>
      <div className="mt-6 flex flex-col gap-2">
        {SHORTCUT_HINTS.map((hint) => (
          <div
            key={hint.keys}
            className="flex items-center justify-between gap-4 text-[13px] text-[var(--text-faint)]"
          >
            <span>{hint.label}</span>
            <Kbd>{hint.keys}</Kbd>
          </div>
        ))}
      </div>
    </div>
  );
}
