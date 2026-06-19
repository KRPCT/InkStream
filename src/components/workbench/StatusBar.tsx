import { getCapabilities } from '../../modes/capabilities';
import { useSettingsStore } from '../../stores/useSettingsStore';
import CitationIndicator from './CitationIndicator';
import CursorPositionIndicator from './CursorPositionIndicator';
import FilePathIndicator from './FilePathIndicator';
import GitBranchIndicator from './GitBranchIndicator';
import HudHintIndicator from './HudHintIndicator';
import ModeIndicator from './ModeIndicator';
import RenderModeIndicator from './RenderModeIndicator';
import WordCountIndicator from './WordCountIndicator';

/**
 * StatusBar 插槽：高 24px、顶部 1px 边框（UI-SPEC Layout Contract）。
 * 左侧 Phase 2 放文件信息；右侧渲染模式指示器（EDIT-02 / D-05）与三模式指示器（D-08）并列。
 */
export default function StatusBar() {
  // 简易模式隐藏 git / 引用 / 模式 / 字数指示器，仅留文件路径 + 光标 + 渲染模式。
  const caps = getCapabilities(useSettingsStore((s) => s.simpleMode));
  return (
    <footer
      data-testid="status-bar"
      className="flex h-6 shrink-0 items-center justify-between border-t border-[var(--background-modifier-border)] bg-[var(--background-secondary)] pl-2 text-[12px] text-[var(--text-muted)]"
    >
      <div data-testid="status-bar-left" className="flex h-full min-w-0">
        {caps.showGit ? <GitBranchIndicator /> : null}
        <FilePathIndicator />
      </div>
      <div data-testid="status-bar-right" className="flex h-full">
        <CursorPositionIndicator />
        {caps.showWordCount ? <WordCountIndicator /> : null}
        <HudHintIndicator />
        {caps.showCitation ? <CitationIndicator /> : null}
        <RenderModeIndicator />
        {caps.showModeSwitch ? <ModeIndicator /> : null}
      </div>
    </footer>
  );
}
