import { FileText, FolderOpen } from 'lucide-react';
import { useRef } from 'react';
import EmptyState from '../common/EmptyState';
import { useCodeMirror } from '../../editor/useCodeMirror';
import { requestOpenFolder } from '../../editor/vaultFlow';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';

/** 空态「打开文件夹」按钮（Heading 14/600，沿 UI-SPEC 主操作入口）。 */
function OpenFolderButton() {
  return (
    <button
      type="button"
      onClick={() => void requestOpenFolder()}
      className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[14px] font-semibold text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
    >
      打开文件夹
    </button>
  );
}

/**
 * EditorArea：全 App 唯一 CM6 容器 + 二态空态（UI-SPEC 逐空态表）。
 *
 * CM 容器随 App 生命周期常驻（WorkbenchLayout 五插槽永不卸载）——空态只是覆盖层，
 * useCodeMirror 始终挂载在隐藏的 parentRef 上，切 tab 走 setState 换装不重建。
 * tab 栏 / 提示条 / 工具条槽位留 02-03/02-04。
 */
export default function EditorArea() {
  const parentRef = useRef<HTMLDivElement | null>(null);
  useCodeMirror(parentRef);
  const vault = useVaultStore((s) => s.vault);
  const activePath = useEditorStore((s) => s.activePath);

  return (
    <div className="relative h-full bg-[var(--background-primary)]">
      {/* 单内核 DOM 挂载点：始终存在；无活动文件时由空态覆盖层遮住 */}
      <div ref={parentRef} className="h-full overflow-auto" data-testid="cm-mount" />
      {!vault ? (
        <div className="absolute inset-0 bg-[var(--background-primary)]">
          <EmptyState
            icon={FolderOpen}
            heading="未打开工作区"
            body="打开一个文件夹作为工作区，开始写作。"
            action={<OpenFolderButton />}
          />
        </div>
      ) : !activePath ? (
        <div className="absolute inset-0 bg-[var(--background-primary)]">
          <EmptyState
            icon={FileText}
            heading="未打开文件"
            body="在左侧文件树中选择文件，或按 Ctrl+P 快速打开。"
          />
        </div>
      ) : null}
    </div>
  );
}
