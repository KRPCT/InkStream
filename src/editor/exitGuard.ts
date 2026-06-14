import { windowControls } from '../ipc/window';
import { confirmDestructive } from '../stores/useConfirmStore';
import { useGitStore } from '../stores/useGitStore';

/**
 * 未提交退出提醒（簇① / 用户需求）：关窗时若 git 工作区有未提交改动，拦下并确认。
 *
 * 改动不会丢（已落盘 + autosave），故这是「提醒提交、保持版本卫生」的温和确认，非数据丢失告警（文案据实、不夸张、不拟人化）。
 * 非 git 工作区 / 无改动 → 不拦，正常关闭。onCloseRequested 须**同步** preventDefault 再异步确认，确认后 destroy 真正关闭。
 *
 * StrictMode 双执行：用代际令牌（同 externalChange 范式）——在途订阅解析时若已被后续 stop/init 取消则自解，不泄漏不重复拦截。
 */
let unlisten: (() => void) | null = null;
let generation = 0;

export function initExitGuard(): void {
  stopExitGuard();
  const myGen = generation;
  void windowControls
    .onCloseRequested(async (event) => {
      const git = useGitStore.getState();
      const count = git.repoRoot !== null ? (git.status?.files.length ?? 0) : 0;
      if (count === 0) return; // 非 git / 无未提交改动 → 放行关闭
      event.preventDefault(); // 必须同步先拦，再异步确认
      const ok = await confirmDestructive({
        title: '有未提交的更改',
        body: `当前工作区有 ${count} 个文件的更改尚未提交。更改已保存在本地、不会丢失，但还未进入 git 版本历史。确定退出？`,
        confirmLabel: '仍然退出',
      });
      if (ok) await windowControls.destroy();
    })
    .then((fn) => {
      if (generation !== myGen) {
        fn();
        return;
      }
      unlisten = fn;
    });
}

export function stopExitGuard(): void {
  generation += 1;
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}
