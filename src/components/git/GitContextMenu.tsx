import {
  checkoutTarget,
  cherryPickCommit,
  createBranchAt,
  createTagAt,
  deleteBranchNamed,
  deleteTagNamed,
  mergeBranchInto,
  resetTo,
  revertCommit,
} from '../../editor/gitActions';
import Menu, { type MenuEntry } from '../common/Menu';
import type { MenuPosition } from '../workbench/EditorContextMenu';
import type { GitRef } from '../../types/git';

/**
 * git-graph 提交行右键菜单（Phase 6 GIT-03）：提交级操作（checkout/分支/tag/cherry-pick/revert/reset/复制哈希）
 * + 本行携带的分支/tag ref 子操作（切换/合并/删除）。复用通用 Menu + gitActions（含二次确认/输入对话框）。
 * 固定定位到右键坐标（同 EditorContextMenu 范式），全屏覆盖层捕外点/二次右键关闭。
 */
interface Props {
  position: MenuPosition;
  oid: string;
  refs: GitRef[];
  currentBranch: string | null;
  onClose: () => void;
}

/** onSelect 包装：Menu 在 onSelect 后自闭；动作多为打开确认/输入对话框（异步，不在此 await）。 */
const act = (fn: () => unknown) => () => {
  void fn();
};

function buildItems(oid: string, refs: GitRef[], currentBranch: string | null): MenuEntry[] {
  const items: MenuEntry[] = [
    { id: 'checkout-commit', label: '切换到此提交', onSelect: act(() => checkoutTarget(oid)) },
    { id: 'branch-here', label: '在此创建分支…', onSelect: act(() => createBranchAt(oid)) },
    { id: 'tag-here', label: '在此创建标签…', onSelect: act(() => createTagAt(oid)) },
    { id: 'sep1', label: '', separator: true },
    { id: 'cherry', label: 'cherry-pick 到当前分支', onSelect: act(() => cherryPickCommit(oid)) },
    { id: 'revert', label: '撤销此提交（revert）', onSelect: act(() => revertCommit(oid)) },
    {
      id: 'reset',
      label: '重置当前分支到此',
      submenu: [
        { id: 'reset-soft', label: 'Soft（保留改动与暂存）', onSelect: act(() => resetTo(oid, 'soft')) },
        { id: 'reset-mixed', label: 'Mixed（保留改动，清暂存）', onSelect: act(() => resetTo(oid, 'mixed')) },
        { id: 'reset-hard', label: 'Hard（丢弃所有改动）', onSelect: act(() => resetTo(oid, 'hard')) },
      ],
    },
    { id: 'sep2', label: '', separator: true },
    {
      id: 'copy-oid',
      label: '复制提交哈希',
      onSelect: act(() => navigator.clipboard.writeText(oid)),
    },
  ];

  for (const b of refs.filter((r) => r.kind === 'localBranch')) {
    items.push({ id: `sep-b-${b.name}`, label: '', separator: true });
    const sub: MenuEntry[] =
      b.name === currentBranch
        ? [{ id: `cur-${b.name}`, label: '（当前分支）', disabled: true }]
        : [
            { id: `co-${b.name}`, label: '切换到此分支', onSelect: act(() => checkoutTarget(b.name)) },
            { id: `mg-${b.name}`, label: '合并到当前分支', onSelect: act(() => mergeBranchInto(b.name)) },
            { id: `del-${b.name}`, label: '删除分支', onSelect: act(() => deleteBranchNamed(b.name)) },
          ];
    items.push({ id: `branch-${b.name}`, label: `分支 ${b.name}`, submenu: sub });
  }
  for (const t of refs.filter((r) => r.kind === 'tag')) {
    items.push({
      id: `tag-${t.name}`,
      label: `标签 ${t.name}`,
      submenu: [{ id: `deltag-${t.name}`, label: '删除标签', onSelect: act(() => deleteTagNamed(t.name)) }],
    });
  }
  return items;
}

export default function GitContextMenu({ position, oid, refs, currentBranch, onClose }: Props) {
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50"
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <Menu
        items={buildItems(oid, refs, currentBranch)}
        label="Git 操作"
        onClose={onClose}
        className="fixed"
        style={{ left: position.x, top: position.y }}
      />
    </div>
  );
}
