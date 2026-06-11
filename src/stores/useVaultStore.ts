import { create } from 'zustand';
import type { TreeNode, VaultInfo } from '../types/vault';

interface VaultState {
  /** 当前打开的 vault；无 vault 时为 null（空态）。 */
  vault: VaultInfo | null;
  /** react-arborist 受控 data：文件树节点（文件夹优先 + locale 序由 FileTree 组织）。 */
  tree: TreeNode[];
  /** 已展开目录的 id 集合（受控展开态，D-11）。 */
  expanded: Set<string>;
  openVault: (vault: VaultInfo, tree: TreeNode[]) => void;
  clearVault: () => void;
  setTree: (tree: TreeNode[]) => void;
  toggleExpanded: (id: string) => void;
}

/**
 * 当前 vault / 文件树 / 仓库根状态层。
 *
 * 真相源纪律：EditorView / EditorState 实例绝不进此 store——store 只持可序列化的
 * vault 元数据与树数据。非 React 模块（命令副作用）经 getState() 调用（同 useToastStore 纪律）。
 */
export const useVaultStore = create<VaultState>((set) => ({
  vault: null,
  tree: [],
  expanded: new Set<string>(),
  openVault: (vault, tree) => set({ vault, tree, expanded: new Set<string>() }),
  clearVault: () => set({ vault: null, tree: [], expanded: new Set<string>() }),
  setTree: (tree) => set({ tree }),
  toggleExpanded: (id) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expanded: next };
    }),
}));
