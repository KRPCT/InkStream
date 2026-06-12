import { create } from 'zustand';
import type { FileEntry, TreeNode, VaultInfo } from '../types/vault';

/** 最近 vault 列表上限（与 validateVault 同值，D-08）。 */
const RECENT_LIMIT = 20;

interface VaultState {
  /** 当前打开的 vault；无 vault 时为 null（空态）。 */
  vault: VaultInfo | null;
  /** react-arborist 受控 data：文件树节点（文件夹优先 + locale 序由 FileTree 组织）。 */
  tree: TreeNode[];
  /** 快速打开（Ctrl+P）的 vault 文件清单快照（FILE-03；fileProvider 同步消费）。 */
  files: FileEntry[];
  /** 已展开目录的 id 集合（受控展开态，D-11；仅会话内有效——开 vault 恒从全折叠开始）。 */
  expanded: Set<string>;
  /** 最近打开 vault 路径列表（置顶去重，上限 20，D-07）。 */
  recentVaults: string[];
  /** 上次打开的 vault 路径（启动恢复目标，D-07）。 */
  lastVaultPath: string | null;
  openVault: (vault: VaultInfo, tree: TreeNode[]) => void;
  clearVault: () => void;
  setTree: (tree: TreeNode[]) => void;
  /** 刷新快速打开文件清单快照（openVaultByPath 打开后 / watcher 变更后调用）。 */
  setFiles: (files: FileEntry[]) => void;
  toggleExpanded: (id: string) => void;
  /** 最近列表置顶去重（打开 vault 时调）。 */
  pushRecent: (path: string) => void;
  /** 记录上次 vault 路径（D-07 启动恢复）。 */
  setLastVaultPath: (path: string | null) => void;
  /** 应用持久态（persistVault 启动 hydrate）：最近 + 上次路径。展开态不恢复（恒折叠起步）。 */
  hydratePersisted: (data: { recentVaults: string[]; lastVaultPath: string | null }) => void;
}

/**
 * 当前 vault / 文件树 / 仓库根 / 最近列表状态层。
 *
 * 真相源纪律：EditorView / EditorState 实例绝不进此 store——store 只持可序列化的
 * vault 元数据与树数据。非 React 模块（命令副作用）经 getState() 调用（同 useToastStore 纪律）。
 */
export const useVaultStore = create<VaultState>((set) => ({
  vault: null,
  tree: [],
  files: [],
  expanded: new Set<string>(),
  recentVaults: [],
  lastVaultPath: null,
  openVault: (vault, tree) => set({ vault, tree, files: [], expanded: new Set<string>() }),
  clearVault: () => set({ vault: null, tree: [], files: [], expanded: new Set<string>() }),
  setTree: (tree) => set({ tree }),
  setFiles: (files) => set({ files }),
  toggleExpanded: (id) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expanded: next };
    }),
  pushRecent: (path) =>
    set((s) => ({
      recentVaults: [path, ...s.recentVaults.filter((p) => p !== path)].slice(0, RECENT_LIMIT),
    })),
  setLastVaultPath: (lastVaultPath) => set({ lastVaultPath }),
  hydratePersisted: ({ recentVaults, lastVaultPath }) => set({ recentVaults, lastVaultPath }),
}));
