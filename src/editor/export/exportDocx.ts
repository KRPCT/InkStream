import type { ExportMeta } from '../../types/export';
import { dataUriToPng, type EmbeddedPng, scaleToFit } from './imageEmbed';

/**
 * 正文 HTML → DOCX Blob（FEAT-EXPORT）：复用 markdownToHtml 的同一份结构化 HTML（单一 md→结构来源），
 * 经 DOMParser 走 DOM 映射到 docx（OOXML）。docx 9.7.1 懒加载（dynamic import，首屏不含）；浏览器路径
 * Packer.toBlob（非 toBuffer，后者要 Node Buffer）。品牌：核心属性 creator/description 始终写，页脚受 meta 控制。
 *
 * 图片内嵌：runExport 已把本地图替换为 data: URI（imageEmbed.resolveExportImages）；此处先把所有 data: 图经
 * canvas 解码为 PNG 字节 + 尺寸（dataUriToPng），再以 ImageRun 真正嵌入 DOCX（等比缩到版心宽，不溢出）。
 * 非 data: 图（远程未抓取 / 解析失败 #）回落 `[图片: …]` 占位文本，不破坏文档结构。
 *
 * v1 取舍：标题/段落/列表/引用/代码/分割线/表格 + 行内 粗/斜/删/码 + 本地图内嵌完整；嵌套列表、超链接、
 * 数学（MathML）退化为文本（不破坏文档结构）。
 */

type Docx = typeof import('docx');

const HEADINGS = [
  'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6',
] as const;

/** DOCX 内嵌图版心最大宽度（px，约 Letter 6.5in@96dpi）：超宽图等比缩到此值，绝不溢出页面。 */
const MAX_IMAGE_WIDTH = 600;

interface Fmt {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  font?: string;
}

/** DOCX 构建上下文：docx 模块 + 预解码的内嵌图表（data: src → PNG 字节 + 原始尺寸）。 */
interface DocxCtx {
  d: Docx;
  pics: ReadonlyMap<string, EmbeddedPng>;
}

type Run = InstanceType<Docx['TextRun']> | InstanceType<Docx['ImageRun']>;

/** 递归收集元素内的行内内容为 Run[]（粗/斜/删/码 累积；br 换行；img 内嵌或占位）。 */
function collectRuns(node: Node, c: DocxCtx, fmt: Fmt, runs: Run[]): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      const t = child.textContent ?? '';
      if (t) runs.push(new c.d.TextRun({ text: t, ...fmt }));
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      runs.push(new c.d.TextRun({ text: '', break: 1 }));
      return;
    }
    if (tag === 'img') {
      const src = el.getAttribute('src') ?? '';
      const pic = c.pics.get(src);
      if (pic) {
        const { width, height } = scaleToFit(pic.width, pic.height, MAX_IMAGE_WIDTH);
        runs.push(
          new c.d.ImageRun({ type: 'png', data: pic.data, transformation: { width, height } }),
        );
        return;
      }
      const label = el.getAttribute('alt') || src || '';
      runs.push(new c.d.TextRun({ text: `[图片: ${label}]`, ...fmt }));
      return;
    }
    const next: Fmt = { ...fmt };
    if (tag === 'strong' || tag === 'b') next.bold = true;
    else if (tag === 'em' || tag === 'i') next.italics = true;
    else if (tag === 's' || tag === 'del') next.strike = true;
    else if (tag === 'code') next.font = 'Consolas';
    collectRuns(el, c, next, runs);
  });
}
function runsOf(el: Element, c: DocxCtx, fmt: Fmt = {}): Run[] {
  const runs: Run[] = [];
  collectRuns(el, c, fmt, runs);
  return runs.length ? runs : [new c.d.TextRun('')];
}

function tableOf(el: Element, c: DocxCtx): InstanceType<Docx['Table']> {
  const rows = Array.from(el.querySelectorAll('tr')).map(
    (tr) =>
      new c.d.TableRow({
        children: Array.from(tr.children).map(
          (td) => new c.d.TableCell({ children: [new c.d.Paragraph({ children: runsOf(td, c) })] }),
        ),
      }),
  );
  return new c.d.Table({ rows, width: { size: 100, type: c.d.WidthType.PERCENTAGE } });
}

type Block = InstanceType<Docx['Paragraph']> | InstanceType<Docx['Table']>;

/** 列表 → 缩进项段落：本项直接内容（其 <p>，跳过嵌套列表）为一段，嵌套 <ul>/<ol> 递归 level+1（docx 上限 8）。 */
function pushList(el: Element, c: DocxCtx, out: Block[], level: number): void {
  Array.from(el.children).forEach((li) => {
    if (li.tagName.toLowerCase() !== 'li') return;
    const runs: Run[] = [];
    li.childNodes.forEach((n) => {
      if (n.nodeType === 1) {
        const t = (n as HTMLElement).tagName.toLowerCase();
        if (t === 'ul' || t === 'ol') return; // 嵌套列表在下面递归
      }
      collectRuns(n, c, {}, runs);
    });
    out.push(new c.d.Paragraph({ children: runs.length ? runs : [new c.d.TextRun('')], bullet: { level: Math.min(level, 8) } }));
    Array.from(li.children).forEach((ch) => {
      const t = ch.tagName.toLowerCase();
      if (t === 'ul' || t === 'ol') pushList(ch, c, out, level + 1);
    });
  });
}

function blockOf(el: Element, c: DocxCtx, out: Block[]): void {
  const d = c.d;
  const tag = el.tagName.toLowerCase();
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) {
    out.push(new d.Paragraph({ heading: d.HeadingLevel[HEADINGS[Number(heading[1]) - 1]], children: runsOf(el, c) }));
  } else if (tag === 'p') {
    out.push(new d.Paragraph({ children: runsOf(el, c) }));
  } else if (tag === 'ul' || tag === 'ol') {
    pushList(el, c, out, 0);
  } else if (tag === 'blockquote') {
    Array.from(el.children).forEach((inner) =>
      out.push(new d.Paragraph({ children: runsOf(inner, c, { italics: true }), indent: { left: 360 } })),
    );
  } else if (tag === 'pre') {
    // 保留代码块换行：逐行 TextRun，行间 break:1（同 collectRuns 处理 <br>）。
    const runs: Run[] = [];
    (el.textContent ?? '').split('\n').forEach((line, i) => {
      if (i > 0) runs.push(new d.TextRun({ text: '', break: 1 }));
      runs.push(new d.TextRun({ text: line, font: 'Consolas' }));
    });
    out.push(new d.Paragraph({ children: runs.length ? runs : [new d.TextRun({ text: '', font: 'Consolas' })] }));
  } else if (tag === 'hr') {
    out.push(new d.Paragraph({ thematicBreak: true }));
  } else if (tag === 'table') {
    out.push(tableOf(el, c));
  } else {
    const t = el.textContent?.trim();
    if (t) out.push(new d.Paragraph({ children: [new d.TextRun(t)] }));
  }
}

/**
 * 预解码正文里所有 data: 图为 PNG 字节（canvas 统一格式 + 取尺寸）。非 data: 图（远程 / 解析失败 #）
 * 不入表，渲染为占位文本。同一 src 只解码一次（多处引用复用）。
 */
async function decodeEmbeddedImages(container: Element | null): Promise<Map<string, EmbeddedPng>> {
  const pics = new Map<string, EmbeddedPng>();
  if (!container) return pics;
  const seen = new Set<string>();
  await Promise.all(
    Array.from(container.querySelectorAll('img')).map(async (img) => {
      const src = img.getAttribute('src') ?? '';
      if (!src.startsWith('data:') || seen.has(src)) return;
      seen.add(src);
      const png = await dataUriToPng(src);
      if (png) pics.set(src, png);
    }),
  );
  return pics;
}

/** 正文 HTML + 元数据 → DOCX Blob。 */
export async function htmlToDocxBlob(bodyHtml: string, meta: ExportMeta): Promise<Blob> {
  const d = await import('docx');
  const dom = new DOMParser().parseFromString(`<div>${bodyHtml}</div>`, 'text/html');
  const container = dom.body.firstElementChild;
  const c: DocxCtx = { d, pics: await decodeEmbeddedImages(container) };
  const blocks: Block[] = [];
  if (container) Array.from(container.children).forEach((el) => blockOf(el, c, blocks));

  const brand = meta.brandingText.trim();
  const footers =
    meta.brandingFooter && brand
      ? {
          default: new d.Footer({
            children: [
              new d.Paragraph({
                alignment: d.AlignmentType.CENTER,
                children: [new d.TextRun({ text: brand, color: '8C959F', size: 16 })],
              }),
            ],
          }),
        }
      : undefined;

  const doc = new d.Document({
    creator: 'InkStream',
    description: meta.generator,
    title: meta.title,
    sections: [{ children: blocks, footers }],
  });
  return d.Packer.toBlob(doc);
}
