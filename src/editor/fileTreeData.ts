import { listDir, listFiles } from '../ipc/vault';
import { useVaultStore } from '../stores/useVaultStore';
import type { TreeEntry, TreeNode } from '../types/vault';

/**
 * react-arborist 受控树纯数据（A2/Pitfall 5）：扁平 entries → 排序节点 / 懒加载回填 / 重水合。
 *
 * 从 vaultFlow 析出（289 行超限），与 vault 生命周期、文件打开编排解耦。非 React 模块，
 * 经 getState() 读写 useVaultStore.tree（受控 data，写操作/watcher 外部变更同一刷新入口）。
 */

/** 文件夹优先 + Intl.Collator locale 排序（D-11：中文按拼音序）。 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 扁平 TreeEntry[] 排序并转 react-arborist 受控 data（目录 children 空 + loaded:false 待懒加载）。 */
export function entriesToNodes(entries: TreeEntry[]): TreeNode[] {
  return [...entries]
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // 文件夹优先
      return collator.compare(a.name, b.name);
    })
    .map((e) => ({
      id: e.path,
      name: e.name,
      isDir: e.isDir,
      // 目录给空 children + loaded:false：react-arborist 据 children 存在判定可展开，
      // loaded 标志区分「未加载」与「加载后为空」（02-03 懒加载在展开时回填 children + loaded:true）。
      ...(e.isDir ? { children: [] as TreeNode[], loaded: false } : {}),
    }));
}

/**
 * 不可变地把某目录 id 的 children 合并进树（02-03 懒加载回填 / refreshTree 重水合）。
 *
 * 纯函数：深度优先按 id 定位目标目录，替换其 children 并标 loaded:true；其余节点引用不变
 * （react-arborist 受控 data 的最小变更，避免整树重建塌陷其它展开子树）。未命中原样返回。
 */
export function updateNodeChildren(tree: TreeNode[], id: string, children: TreeNode[]): TreeNode[] {
  let changed = false;
  const next = tree.map((n) => {
    if (n.id === id) {
      changed = true;
      return { ...n, children, loaded: true };
    }
    if (n.children && n.children.length > 0) {
      const merged = updateNodeChildren(n.children, id, children);
      if (merged !== n.children) {
        changed = true;
        return { ...n, children: merged };
      }
    }
    return n;
  });
  return changed ? next : tree;
}

/**
 * 收集树中所有已加载目录 id，按路径深度浅→深排序（refreshTree 重水合顺序）。
 *
 * 浅在前：父目录子项先回填后，再回填其下深层子目录——深层 updateNodeChildren 才能
 * 在已重建的父 children 里命中并重标 loaded:true，保证多级展开子树完整复原而非塌陷。
 */
function collectLoadedDirs(tree: TreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.isDir && n.loaded === true) ids.push(n.id);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return ids.sort((a, b) => a.split('/').length - b.split('/').length);
}

/** 深度优先按 id 找节点（懒加载判断目录的 loaded 状态）。 */
function findNode(tree: TreeNode[], id: string): TreeNode | undefined {
  for (const n of tree) {
    if (n.id === id) return n;
    if (n.children) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * 展开某目录时懒加载其直接子项（02-03）：仅当目录尚未加载（loaded !== true）时 listDir，
 * 转节点后合并进树并标 loaded:true；已加载目录直接 no-op（不重复取盘）。
 */
export async function expandDir(id: string): Promise<void> {
  const { vault, tree } = useVaultStore.getState();
  if (!vault) return;
  const node = findNode(tree, id);
  if (!node || !node.isDir || node.loaded === true) return;
  try {
    const children = entriesToNodes(await listDir(vault.root, id));
    useVaultStore.getState().setTree(updateNodeChildren(useVaultStore.getState().tree, id, children));
  } catch {
    // 子目录枚举失败：保持未加载态，下次展开可重试（不污染已有树）
  }
}

/**
 * 文件树展开/折叠的单一同步点（react-arborist onToggle 回调，仅给 id）。
 *
 * onToggle 在内部 open 态已翻转后触发：以 store.expanded 为开合意图真相源同步翻转，
 * 翻成「打开」且该目录尚未加载时懒加载子项（expandDir）。展开态仅会话内有效——
 * 开 vault 恒从全折叠开始（openByDefault=false），不跨会话恢复（恢复的展开目录
 * 因懒加载未触发会显示为空）。
 */
export async function handleToggle(id: string): Promise<void> {
  const { expanded, tree } = useVaultStore.getState();
  const willOpen = !expanded.has(id);
  useVaultStore.getState().toggleExpanded(id);
  if (!willOpen) return;
  const node = findNode(tree, id);
  if (node?.isDir && node.loaded !== true) await expandDir(id);
}

/**
 * 重新枚举当前 vault 根目录 → 回流 useVaultStore.tree + files 快照（FILE-01 写操作后 /
 * watcher 外部变更后调用）。无 vault 时静默 no-op。
 *
 * 受控 data 刷新（A2/Pitfall 5）：写操作成功后回流真相树，与 watcher 外部刷新同一入口，
 * 避免乐观更新与磁盘真相漂移。同时刷新快速打开 files 快照（FILE-03，补 02-06 carry-forward）。
 */
export async function refreshTree(): Promise<void> {
  const vault = useVaultStore.getState().vault;
  if (!vault) return;
  try {
    // 收集刷新前已加载的目录 id（浅→深排序），重列根后逐个重水合，避免塌陷所有展开子树。
    const loadedDirs = collectLoadedDirs(useVaultStore.getState().tree);
    let tree = entriesToNodes(await listDir(vault.root, ''));
    for (const id of loadedDirs) {
      // 目录在新树中仍存在（未被删除/移动）才重取——找不到说明已消失，跳过。
      if (!findNode(tree, id)) continue;
      try {
        const children = entriesToNodes(await listDir(vault.root, id));
        tree = updateNodeChildren(tree, id, children);
      } catch {
        // 单个子目录重取失败（可能已删）：跳过，不阻断整体刷新
      }
    }
    useVaultStore.getState().setTree(tree);
  } catch {
    // 枚举失败不清空已有树（避免误删视图）；仅快照刷新尽力而为
  }
  try {
    const files = await listFiles(vault.root);
    useVaultStore.getState().setFiles(files);
  } catch {
    /* 快速打开快照刷新失败不阻断 */
  }
}
