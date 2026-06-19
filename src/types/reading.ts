/** 阅读模式（FEAT-READ）类型契约：沉浸式阅读 txt / docx / epub / pdf。 */

/** 支持的阅读格式（按扩展名判定）。 */
export type ReadingFormat = 'txt' | 'docx' | 'epub' | 'pdf';

/** 文体：小说 vs 文献（规则启发式自动识别，用户可手动覆盖），驱动排版预设。 */
export type ReadingGenre = 'novel' | 'literature';

/** 阅读主题（与应用主题正交的护眼配色）。 */
export type ReadingTheme = 'light' | 'sepia' | 'dark';

/** 阅读偏好（会话内内存态，不持久化）。 */
export interface ReadingPrefs {
  /** 正文字号（px）。 */
  fontSize: number;
  /** 阅读配色。 */
  theme: ReadingTheme;
}

/** 当前打开的阅读文档元数据（解析后的内容缓存在模块级，不进 store）。 */
export interface ReadingDoc {
  /** 绝对路径（或库内相对路径——作为打开键）。 */
  path: string;
  /** 显示名（文件名）。 */
  name: string;
  format: ReadingFormat;
}
