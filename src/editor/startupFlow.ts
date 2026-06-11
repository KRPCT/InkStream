import { showToast } from '../stores/useToastStore';
import { useVaultStore } from '../stores/useVaultStore';
import { switchVault } from './vaultFlow';

/**
 * 启动恢复上次 vault（D-07）：persistVault hydrate 后调用。
 *
 * 有 lastVaultPath → switchVault 恢复（含 watcher 启动）；失效（文件夹已移动/删除）→
 * 留空态页 + 最近列表，提示「无法打开...已回到上一个工作区」。无上次路径则保持空态。
 */
export async function restoreLastVault(): Promise<void> {
  const last = useVaultStore.getState().lastVaultPath;
  if (!last) return;
  try {
    await switchVault(last);
  } catch {
    // openVaultByPath 已弹「无法打开这个文件夹」错误 toast；此处补回退语义提示
    showToast('warning', '无法打开上次的工作区，已回到空态，可从最近列表重新选择。');
  }
}
