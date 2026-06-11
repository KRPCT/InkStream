/**
 * vault 与文件树相关类型（前端真相源镜像，与 Rust VaultInfo/TreeEntry 形状对齐）。
 */

/** 打开 vault 的返回信息（Rust open_vault → camelCase 序列化）。 */
export interface VaultInfo {
  /** 规范化后的 vault 根绝对路径。 */
  root: string;
  /** 仓库根（向上找到的 .git 所在目录）；非 git 工作区为 null（D-05）。 */
  repoRoot: string | null;
  /** vault 显示名（根目录文件名）。 */
  name: string;
}

/** 文件树单项（Rust list_dir 返回的扁平条目）。 */
export interface TreeEntry {
  /** 条目名（文件/文件夹名，含点开头项）。 */
  name: string;
  /** 相对 vault 根的路径（`/` 分隔）。 */
  path: string;
  /** 是否为目录。 */
  isDir: boolean;
}

/**
 * vault 级持久化磁盘契约（D-08 按 vault 路径键，应用数据目录，用户仓库零写入）。
 *
 * 真相源：tauri-plugin-store 的 vault-state.json。仅持久最近列表 + 上次路径 + 文件树展开态；
 * **不含** tab 列表 / EditorState / undo（D-03 在 tab 持久化议题上覆盖 D-08 的「打开的 tab」字面项）。
 */
export interface PersistedVault {
  version: 1;
  /** 启动恢复目标（D-07）；无则空态页。 */
  lastVaultPath: string | null;
  /** 最近打开 vault 路径列表（置顶去重，上限 20）。 */
  recentVaults: string[];
  /** 按 vault 根路径键的文件树展开节点 id 列表（D-08 路径键）。 */
  expanded: Record<string, string[]>;
}

/** 快速打开（Ctrl+P）单条文件项（Rust list_files → camelCase；FILE-03）。 */
export interface FileEntry {
  /** 文件名（不含路径）。 */
  name: string;
  /** 相对 vault 根的路径（`/` 分隔）。 */
  path: string;
}

/**
 * react-arborist 受控 `data` 的树节点形状（A2/Pitfall 5）。
 * id 用相对路径（唯一）；目录有 children（懒填充时可为空数组），文件 children 省略。
 */
export interface TreeNode {
  /** 节点唯一 id（= 相对 vault 根路径）。 */
  id: string;
  /** 显示名。 */
  name: string;
  /** 是否目录（react-arborist 据 children 是否存在判断 isLeaf，此字段供排序/图标）。 */
  isDir: boolean;
  /** 子节点；目录可有（空数组表示已展开但为空 / 尚未加载用 undefined 区分由消费方定）。 */
  children?: TreeNode[];
  /**
   * 临时新建占位节点的待提交元数据（WR-12）。仅 onCreate 产出的占位节点带此字段——
   * 父目录路径与新建类型从此结构读取，**不再**编码进 id 串（父目录含 ':' 时按 id 分割会错位）。
   */
  pending?: {
    /** 父目录相对路径（根为空串）。 */
    parentPath: string;
    /** 新建类型：目录 or 文件。 */
    isDir: boolean;
  };
}
