import { useEffect, useRef, useState } from 'react';
import { useOpenFolderStore } from '../../stores/useOpenFolderStore';

/**
 * 「打开文件夹」路径输入模态——自绘（照 ConfirmDialog / AboutDialog 范式，拒引未审计
 * tauri-plugin-dialog，T-01-SC / 01-05 决策延续；原生 picker 落地前的最小可用入口）。
 *
 * 显隐源 useOpenFolderStore.request：openFolderDialog() 弹出并 await。
 * 输入绝对路径 → Enter / 打开 → resolve(path)；遮罩点击 / Esc / 取消 → resolve(null)。
 * 空路径不提交（打开按钮禁用，Enter 亦 no-op）。打开后由 vaultFlow 经 switchVault 启用监听。
 */
export default function OpenFolderDialog() {
  const request = useOpenFolderStore((s) => s.request);
  if (!request) return null;
  return <OpenFolderPanel />;
}

function OpenFolderPanel() {
  const request = useOpenFolderStore((s) => s.request);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  if (!request) return null;
  const { resolve } = request;
  const trimmed = value.trim();

  const submit = (): void => {
    if (trimmed.length === 0) return;
    resolve(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      role="presentation"
      onMouseDown={() => resolve(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="打开文件夹"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            resolve(null);
          }
        }}
        className="w-[440px] rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-5 [box-shadow:var(--shadow-popup)]"
      >
        <p className="text-[15px] font-semibold text-[var(--text-normal)]">打开文件夹</p>
        <p className="mt-2 text-[13px] leading-normal text-[var(--text-muted)]">
          粘贴工作区的绝对路径
        </p>
        <input
          ref={inputRef}
          id="open-folder-path-input"
          name="open-folder-path"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="例如 D:\\Notes 或 /Users/me/vault"
          className="mt-4 w-full rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-3 py-1.5 text-[13px] text-[var(--text-normal)] placeholder:text-[var(--text-faint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--interactive-accent)]"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => resolve(null)}
            className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={trimmed.length === 0}
            className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] font-semibold text-[var(--interactive-accent)] hover:bg-[var(--background-modifier-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-faint)] disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--interactive-accent)]"
          >
            打开
          </button>
        </div>
      </div>
    </div>
  );
}
