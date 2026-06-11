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
}
