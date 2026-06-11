import { TriangleAlert } from 'lucide-react';
import { reloadFromDisk } from '../../editor/editorState';
import { flushAutosave } from '../../stores/autosave';
import { confirmDestructive } from '../../stores/useConfirmStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { showToast } from '../../stores/useToastStore';

/**
 * 外部变更冲突提示条（D-04 脏文档分支 / FILE-02）。
 *
 * 仅当活动文件被标记 externalChanged 时显示（脏文档外部变更冲突期）。顶部全宽 36px，
 * --background-secondary-alt 背景 + triangle-alert 非红图标 + 两文字按钮（UI-SPEC）：
 * - 重载（丢弃我的修改）：reloadFromDisk 丢弃编辑 + unfreeze + 清标记
 * - 保留我的（覆盖磁盘）：二次确认 ConfirmDialog → flushAutosave 覆盖 + unfreeze + 清标记
 *
 * 用户选择前该文件自动保存保持冻结（仲裁层已 freezeAutosave），防误覆盖外部变更。
 */
function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export default function ExternalChangeBar() {
  const activePath = useEditorStore((s) => s.activePath);
  const flagged = useEditorStore((s) => (activePath ? s.externalChanged[activePath] : false));
  if (!activePath || !flagged) return null;

  const path = activePath;
  const name = baseName(path);

  const onReload = async (): Promise<void> => {
    try {
      await reloadFromDisk(path);
    } catch {
      showToast('error', `「${name}」重载失败，请手动重新打开。`);
    }
    const store = useEditorStore.getState();
    store.unfreezeAutosave(path);
    store.clearExternalChange(path);
  };

  const onKeepMine = async (): Promise<void> => {
    const ok = await confirmDestructive({
      title: '覆盖磁盘上的修改',
      body: '确定用编辑器中的内容覆盖磁盘上的修改吗？磁盘上的外部改动将丢失。',
      confirmLabel: '覆盖磁盘',
    });
    if (!ok) return;
    const store = useEditorStore.getState();
    // 先解冻再 flush：flushAutosave 在 frozen 时会跳过落盘
    store.unfreezeAutosave(path);
    store.clearExternalChange(path);
    await flushAutosave(path);
  };

  return (
    <div
      role="alert"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--background-modifier-border)] bg-[var(--background-secondary-alt)] px-3"
    >
      <TriangleAlert size={16} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-normal)]">
        「{name}」已被其他程序修改，磁盘上的内容与你的编辑不同。
      </span>
      <button
        type="button"
        onClick={() => void onReload()}
        className="shrink-0 rounded-[4px] px-2 py-1 text-[13px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
      >
        重载（丢弃我的修改）
      </button>
      <button
        type="button"
        onClick={() => void onKeepMine()}
        className="shrink-0 rounded-[4px] px-2 py-1 text-[13px] font-semibold text-[var(--color-error)] hover:bg-[var(--background-modifier-hover)]"
      >
        保留我的（覆盖磁盘）
      </button>
    </div>
  );
}
