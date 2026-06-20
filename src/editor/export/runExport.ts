import { getAppVersion } from '../../ipc/app';
import { pickExportPath } from '../../ipc/dialog';
import { writeBytesToPath, writeFileToPath } from '../../ipc/files';
import { pandocConvert } from '../../ipc/pandoc';
import { useEditorStore } from '../../stores/useEditorStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { showToast } from '../../stores/useToastStore';
import type { ExportFormat, ExportMeta, PandocFormat } from '../../types/export';
import { readFields } from '../frontmatter';
import { loadKatex } from '../livepreview/mathLoader';
import { getView } from '../viewHandle';
import { htmlToDocxBlob } from './exportDocx';
import { buildHtmlDocument } from './htmlDocument';
import { PANDOC_FORMATS } from './pandocFormats';
import { printHtml } from './exportPdf';
import { markdownToHtml, type MathRenderer } from './markdownToHtml';

/**
 * 文件导出编排（FEAT-EXPORT）：取真相源 doc（getView().state.doc）→ markdown→HTML（公式经 KaTeX→MathML，
 * 缺则降级代码块）→ 按格式落盘。PDF 走系统打印「另存为 PDF」（无保存对话框）；HTML/DOCX 经原生保存对话框 +
 * Rust 原子写（文本 / 二进制）。成功静默（同 saveDraftAs），取消静默返回，失败 error toast。
 */

const LABELS: Record<ExportFormat, string> = { html: 'HTML', pdf: 'PDF', docx: 'DOCX' };

/** 活动文件名去扩展名作默认导出名；无活动路径用「未命名」。 */
function baseName(path: string | null): string {
  if (!path) return '未命名';
  const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
  return name.replace(/\.[^.]+$/, '') || '未命名';
}

/** KaTeX → MathML 渲染器（自包含、无需 CSS）；加载失败返回 undefined 使公式降级为代码块。 */
async function buildMathRenderer(): Promise<MathRenderer | undefined> {
  try {
    const katex = await loadKatex();
    return (s, display) =>
      katex.renderToString(s, { displayMode: display, output: 'mathml', throwOnError: false });
  } catch {
    return undefined;
  }
}

export async function exportDocument(format: ExportFormat): Promise<void> {
  const view = getView();
  if (!view) {
    showToast('warning', '请先打开一个文档再导出。');
    return;
  }
  const markdown = view.state.doc.toString();
  const name = baseName(useEditorStore.getState().activePath);
  const meta: ExportMeta = {
    title: readFields(markdown, ['title']).title || name,
    brandingFooter: useSettingsStore.getState().exportBrandingFooter,
    brandingText: useSettingsStore.getState().exportBrandingText,
    generator: `InkStream ${await getAppVersion()}`,
  };
  const renderMath = await buildMathRenderer();
  const bodyHtml = markdownToHtml(markdown, { renderMath });

  try {
    if (format === 'pdf') {
      printHtml(buildHtmlDocument(bodyHtml, meta));
      return;
    }
    if (format === 'html') {
      const path = await pickExportPath(`${name}.html`, 'html');
      if (!path) return;
      await writeFileToPath(path, buildHtmlDocument(bodyHtml, meta));
      return;
    }
    const path = await pickExportPath(`${name}.docx`, 'docx');
    if (!path) return;
    const blob = await htmlToDocxBlob(bodyHtml, meta);
    await writeBytesToPath(path, new Uint8Array(await blob.arrayBuffer()));
  } catch {
    showToast('error', `导出 ${LABELS[format]} 失败，请重试。`);
  }
}

/**
 * pandoc 通道无 buildHtmlDocument/DOCX Footer，故把水印作为 markdown 末尾追加（pandoc 转入目标格式）。
 * 水印文字去换行 + 转义 markdown 元字符 → 作为字面文本而非标记（与 HTML/DOCX 的 esc 同纪律，防 `# x`/`---` 改变文档结构）。
 */
export function withWatermark(markdown: string): string {
  const { exportBrandingFooter, exportBrandingText } = useSettingsStore.getState();
  const text = exportBrandingText.trim();
  if (!exportBrandingFooter || !text) return markdown;
  const safe = text.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]()#+\-.!>~|])/g, '\\$1');
  return `${markdown}\n\n---\n\n*${safe}*\n`;
}

/** pandoc 导出（odt/rtf/latex/epub/typst/org）：当前文档 gfm markdown → pandoc → 保存对话框选定路径。 */
export async function exportViaPandoc(format: PandocFormat): Promise<void> {
  const view = getView();
  if (!view) {
    showToast('warning', '请先打开一个文档再导出。');
    return;
  }
  const spec = PANDOC_FORMATS.find((f) => f.id === format);
  if (!spec) return;
  const name = baseName(useEditorStore.getState().activePath);
  const path = await pickExportPath(`${name}.${spec.ext}`, format);
  if (!path) return;
  try {
    await pandocConvert(withWatermark(view.state.doc.toString()), path, format);
  } catch (e) {
    showToast('error', typeof e === 'string' ? e : `导出 ${spec.label} 失败（pandoc）。`);
  }
}
