/** 文件导出（FEAT-EXPORT）类型契约。 */

/** 内置导出格式（PDF 走系统打印「另存为 PDF」，HTML/DOCX 走原生保存对话框 + 文件写）。 */
export type ExportFormat = 'html' | 'pdf' | 'docx';

/** pandoc 解锁的更多导出格式（系统装有 pandoc 时可用）；格式键即 pandoc --to 值。 */
export type PandocFormat = 'odt' | 'rtf' | 'latex' | 'epub' | 'typst' | 'org';

/** 导出元数据：标题 + 品牌页脚开关 + 生成器标识（生成器始终写入产物，页脚受设置控制）。 */
export interface ExportMeta {
  /** 文档标题（frontmatter title 优先，否则文件名）。 */
  title: string;
  /** 是否在产物末尾附水印页脚（用户设置 exportBrandingFooter，默认关）。 */
  brandingFooter: boolean;
  /** 水印文字（brandingFooter 开且非空白时附于页脚；用户设置 exportBrandingText，默认「Made with InkStream」）。 */
  brandingText: string;
  /** 生成器标识（始终写入元数据），如 "InkStream 1.1.0"。 */
  generator: string;
}
