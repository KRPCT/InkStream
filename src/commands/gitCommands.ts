import { useGitStore } from '../stores/useGitStore';
import { showToast } from '../stores/useToastStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import type { Command } from '../types/commands';

/**
 * git 命令（Phase 6 GIT-02）。Command 类型无 enabled 字段（菜单仅按未注册置灰），故 run 内守卫仓库根：
 * 非 git 工作区提示而非打开。Ctrl+Shift+G 沿用 vscode-git-graph 键位降低迁移成本。
 */
export const GIT_COMMANDS: Command[] = [
  {
    id: 'git.toggle-graph',
    title: 'Git Graph',
    shortcut: 'Ctrl+Shift+G',
    advanced: true,
    run: () => {
      if (useGitStore.getState().repoRoot === null) {
        showToast('warning', '当前工作区不是 git 仓库，无法打开 Git Graph。');
        return;
      }
      useWorkbenchStore.getState().toggleCentralView('gitGraph');
    },
  },
];
