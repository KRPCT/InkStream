/** 文件导出（FEAT-EXPORT）类型契约。 */

/** 导出格式（PDF 走系统打印「另存为 PDF」，HTML/DOCX 走原生保存对话框 + 文件写）。 */
export type ExportFormat = 'html' | 'pdf' | 'docx';

/** 导出元数据：标题 + 品牌页脚开关 + 生成器标识（生成器始终写入产物，页脚受设置控制）。 */
export interface ExportMeta {
  /** 文档标题（frontmatter title 优先，否则文件名）。 */
  title: string;
  /** 是否在产物末尾附「Made with InkStream」页脚（用户设置 exportBrandingFooter）。 */
  brandingFooter: boolean;
  /** 生成器标识（始终写入元数据），如 "InkStream 1.0.0"。 */
  generator: string;
}
