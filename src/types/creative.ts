/** Creative 模式领域类型（CREA-01 章节-场景树）。 */

/** 场景写作状态（CREA-01 色点）：frontmatter `status: draft|revised|final`，缺省 draft。 */
export type SceneStatus = 'draft' | 'revised' | 'final';

/** 场景（= 一个 .md 文件）。 */
export interface SceneNode {
  /** 相对 vault 根路径（openFileByPath 用）。 */
  path: string;
  /** 显示名：frontmatter title 优先，否则文件名去扩展名。 */
  name: string;
  status: SceneStatus;
  /** 正文字数（剔除 frontmatter，countWords 同源）。 */
  words: number;
}

/** 章（= 顶层文件夹；或合成「未分章」收纳根级散场景）。 */
export interface ChapterNode {
  /** 章名（文件夹名；未分章为「未分章」）。 */
  name: string;
  /** 章文件夹相对路径；未分章为 null。 */
  path: string | null;
  scenes: SceneNode[];
}
