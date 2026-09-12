import { initializeProjects, startProjectCheckpoints } from '../projects/session';

/**
 * 启动恢复上次 vault（D-07）：persistVault hydrate 后调用。
 *
 * 有 lastVaultPath → switchVault 恢复（含 watcher 启动）；失效（文件夹已移动/删除）→
 * 留空态页 + 最近列表，提示「无法打开...已回到上一个工作区」。无上次路径则保持空态。
 */
export async function restoreLastVault(): Promise<void> {
  await initializeProjects();
  startProjectCheckpoints();
}
