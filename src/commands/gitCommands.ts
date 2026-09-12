import { useGitStore } from '../stores/useGitStore';
import { showToast } from '../stores/useToastStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import type { Command } from '../types/commands';
import { abortRebase, continueRebase, requestRebase, skipRebaseCommit } from '../editor/gitRebaseActions';
import { requestCloneRepository } from '../editor/gitCloneActions';
import { openBranchComparison } from '../editor/gitCompareActions';
import { cancelLocalGitOperation } from '../editor/gitLocalOperation';
import { abortOp } from '../editor/gitActions';

/**
 * git 命令（Phase 6 GIT-02）。Command 类型无 enabled 字段（菜单仅按未注册置灰），故 run 内守卫仓库根：
 * 非 git 工作区提示而非打开。Ctrl+Shift+G 沿用 vscode-git-graph 键位降低迁移成本。
 */
export const GIT_COMMANDS: Command[] = [
  { id: 'git.cancel-local', title: '停止正在执行的本地 Git 操作', advanced: true, run: cancelLocalGitOperation },
  { id: 'git.abort-local', title: '中止未完成的本地 Git 合并/拣选/回退', advanced: true, run: async () => { await abortOp(); } },
  { id: 'git.compare-branches', title: '比较两个分支的完整正文…', advanced: true, run: openBranchComparison },
  { id: 'git.clone', title: '克隆仓库…', advanced: true, run: requestCloneRepository },
  { id: 'git.rebase', title: '本地变基…', advanced: true, run: requestRebase },
  { id: 'git.rebase-continue', title: '继续本地变基', advanced: true, run: continueRebase },
  { id: 'git.rebase-skip', title: '跳过当前变基提交', advanced: true, run: skipRebaseCommit },
  { id: 'git.rebase-abort', title: '中止本地变基', advanced: true, run: async () => { await abortRebase(); } },
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
