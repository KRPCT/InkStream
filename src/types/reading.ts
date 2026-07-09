/** 阅读模式（FEAT-READ）类型契约：沉浸式阅读 txt / md / docx / epub / pdf。 */

/** 支持的阅读格式（按扩展名判定）。md 经阅读命令进入，不自动、也不计入书架收录。 */
export type ReadingFormat = 'txt' | 'md' | 'docx' | 'epub' | 'pdf';

/** 文体：小说 vs 文献（规则启发式自动识别，用户可手动覆盖），驱动排版预设。 */
export type ReadingGenre = 'novel' | 'literature';

/** 阅读主题（与应用主题正交的护眼配色）。 */
export type ReadingTheme = 'light' | 'sepia' | 'dark';

/** 正文字体族：跟随文体预设 / 强制衬线 / 强制无衬线。 */
export type ReadingFontFamily = 'auto' | 'serif' | 'sans';

/** 版心宽度（文本重排）：跟随文体 / 窄 / 宽。 */
export type ReadingWidth = 'auto' | 'narrow' | 'wide';

/** 页边距（留白）：紧凑 / 标准 / 宽松。 */
export type ReadingMargin = 'compact' | 'normal' | 'roomy';

/** 阅读偏好（会话内内存态，不持久化）。 */
export interface ReadingPrefs {
  /** 正文字号（px）。 */
  fontSize: number;
  /** 阅读配色。 */
  theme: ReadingTheme;
  /** 字体族（auto=跟随文体）。 */
  fontFamily: ReadingFontFamily;
  /** 版心宽度（文本重排；auto=文体预设版心）。 */
  width: ReadingWidth;
  /** 页边距（留白档位）。 */
  margin: ReadingMargin;
}

/** 目录项（阅读器自动提取的标题）。blockIndex 指向 HtmlReader 内容块序列的下标（跳转键）。 */
export interface TocItem {
  /** 标题层级 1–6。 */
  level: number;
  /** 标题文本。 */
  text: string;
  /** 所在内容块下标（与 readingNav.scrollToBlock 对齐）。 */
  blockIndex: number;
}

/** 当前打开的阅读文档元数据（解析后的内容缓存在模块级，不进 store）。 */
export interface ReadingDoc {
  /** 绝对路径（或库内相对路径——作为打开键）。 */
  path: string;
  /** 显示名（文件名）。 */
  name: string;
  format: ReadingFormat;
}
