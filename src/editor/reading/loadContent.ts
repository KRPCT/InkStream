import { readFileBytes } from '../../ipc/files';
import type { ReadingFormat } from '../../types/reading';
import { loadEpub } from './loadEpub';

/**
 * 阅读正文加载（FEAT-READ）：路径 → { html, text }。html 在 sandbox iframe 渲染（脚本不执行，守 XSS）；
 * text 供文体识别。docx 经 mammoth（浏览器入口，Vite browser 字段重映射避 Node fs）；epub 经自研 jszip 解析；
 * txt 直接转义分段。pdf 不走此路（PdfReader 用 pdfjs 画 canvas）。重渲染器全部 dynamic import，不进编辑器分包。
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 纯文本 → 段落 HTML（空行分段，每段转义）。 */
function txtToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** HTML 串 → 纯文本（文体识别用，经 DOMParser 不执行内容）。 */
function htmlToText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

export async function loadReadingHtml(
  format: Exclude<ReadingFormat, 'pdf'>,
  path: string,
): Promise<{ html: string; text: string }> {
  const bytes = await readFileBytes(path);
  if (format === 'txt') {
    const text = new TextDecoder('utf-8').decode(bytes);
    return { html: txtToHtml(text), text };
  }
  if (format === 'docx') {
    const mammoth = await import('mammoth');
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const { value } = await mammoth.convertToHtml({ arrayBuffer: buf as ArrayBuffer });
    return { html: value, text: htmlToText(value) };
  }
  return loadEpub(bytes);
}
