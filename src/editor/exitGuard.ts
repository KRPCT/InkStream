import { getCapabilities } from '../modes/capabilities';
import { windowControls } from '../ipc/window';
import { confirmDestructive } from '../stores/useConfirmStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useGitStore } from '../stores/useGitStore';
import { useSettingsStore } from '../stores/useSettingsStore';

/**
 * 退出守卫（簇① / 用户需求）：关窗时按优先级提醒——
 *
 * 1. **未保存文档**（数据安全，所有模式生效）：dirty 文档退出即丢——autosave 关时未 Ctrl+S、草稿（draft://）、
 *    或编辑后尚在防抖窗口未落盘。这是真·数据丢失告警，优先级高于版本卫生。
 * 2. **未提交 git 改动**（版本卫生，仅 git 能力开启时）：完整模式 + git 工作区有未提交改动时温和提醒。
 *    **简易模式 git 关闭 → 跳过本检查，绝不弹 git 上传提醒**（getCapabilities(simpleMode).showGit）。
 *    改动已落盘不会丢，故文案据实、不夸张、不拟人化。
 *
 * 两者皆无 → 不拦，正常关闭。两者皆有 → 只弹未保存提醒（数据丢失更严重；用户接受丢改动自然也接受不提交）。
 * onCloseRequested 须**同步** preventDefault 再异步确认，确认后 destroy 真正关闭。
 * StrictMode 双执行：用代际令牌（同 externalChange 范式）——在途订阅解析时若已被后续 stop/init 取消则自解。
 */
let unlisten: (() => void) | null = null;
let generation = 0;

/** 当前未保存（dirty）文档数：autosave 关 / 草稿 / 防抖未落盘——退出即丢。 */
function unsavedCount(): number {
  return Object.values(useEditorStore.getState().dirty).filter(Boolean).length;
}

/** 未提交 git 改动数；git 能力关闭（简易模式）或非 git 工作区时恒 0（不参与提醒）。 */
function uncommittedCount(): number {
  if (!getCapabilities(useSettingsStore.getState().simpleMode).showGit) return 0;
  const git = useGitStore.getState();
  return git.repoRoot !== null ? (git.status?.files.length ?? 0) : 0;
}

export function initExitGuard(): void {
  stopExitGuard();
  const myGen = generation;
  void windowControls
    .onCloseRequested(async (event) => {
      const unsaved = unsavedCount();
      const uncommitted = uncommittedCount();
      if (unsaved === 0 && uncommitted === 0) return; // 无未保存、无（启用时的）未提交 → 放行关闭
      event.preventDefault(); // 必须同步先拦，再异步确认
      // 未保存优先（数据丢失 > 版本卫生）；简易模式 uncommitted 恒 0，只会走未保存分支。
      const ok =
        unsaved > 0
          ? await confirmDestructive({
              title: '有未保存的更改',
              body: `当前有 ${unsaved} 个文档的更改尚未保存到磁盘，退出将丢失这些更改。确定退出？`,
              confirmLabel: '仍然退出',
            })
          : await confirmDestructive({
              title: '有未提交的更改',
              body: `当前工作区有 ${uncommitted} 个文件的更改尚未提交。更改已保存在本地、不会丢失，但还未进入 git 版本历史。确定退出？`,
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
