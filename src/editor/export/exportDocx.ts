import type { ExportMeta } from '../../types/export';

/**
 * 正文 HTML → DOCX Blob（FEAT-EXPORT）：复用 markdownToHtml 的同一份结构化 HTML（单一 md→结构来源），
 * 经 DOMParser 走 DOM 映射到 docx（OOXML）。docx 9.7.1 懒加载（dynamic import，首屏不含）；浏览器路径
 * Packer.toBlob（非 toBuffer，后者要 Node Buffer）。品牌：核心属性 creator/description 始终写，页脚受 meta 控制。
 *
 * v1 取舍：标题/段落/列表/引用/代码/分割线/表格 + 行内 粗/斜/删/码 完整；嵌套列表、超链接、数学（MathML）
 * 退化为文本（不破坏文档结构）。
 */

type Docx = typeof import('docx');

const HEADINGS = [
  'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6',
] as const;

interface Fmt {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  font?: string;
}

/** 递归收集元素内的行内文本为 TextRun[]（粗/斜/删/码 累积；br/img 特例）。 */
function collectRuns(node: Node, d: Docx, fmt: Fmt, runs: InstanceType<Docx['TextRun']>[]): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      const t = child.textContent ?? '';
      if (t) runs.push(new d.TextRun({ text: t, ...fmt }));
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      runs.push(new d.TextRun({ text: '', break: 1 }));
      return;
    }
    if (tag === 'img') {
      const label = el.getAttribute('alt') || el.getAttribute('src') || '';
      runs.push(new d.TextRun({ text: `[图片: ${label}]`, ...fmt }));
      return;
    }
    const next: Fmt = { ...fmt };
    if (tag === 'strong' || tag === 'b') next.bold = true;
    else if (tag === 'em' || tag === 'i') next.italics = true;
    else if (tag === 's' || tag === 'del') next.strike = true;
    else if (tag === 'code') next.font = 'Consolas';
    collectRuns(el, d, next, runs);
  });
}
function runsOf(el: Element, d: Docx, fmt: Fmt = {}): InstanceType<Docx['TextRun']>[] {
  const runs: InstanceType<Docx['TextRun']>[] = [];
  collectRuns(el, d, fmt, runs);
  return runs.length ? runs : [new d.TextRun('')];
}

function tableOf(el: Element, d: Docx): InstanceType<Docx['Table']> {
  const rows = Array.from(el.querySelectorAll('tr')).map(
    (tr) =>
      new d.TableRow({
        children: Array.from(tr.children).map(
          (td) => new d.TableCell({ children: [new d.Paragraph({ children: runsOf(td, d) })] }),
        ),
      }),
  );
  return new d.Table({ rows, width: { size: 100, type: d.WidthType.PERCENTAGE } });
}

type Block = InstanceType<Docx['Paragraph']> | InstanceType<Docx['Table']>;

/** 列表 → 缩进项段落：本项直接内容（其 <p>，跳过嵌套列表）为一段，嵌套 <ul>/<ol> 递归 level+1（docx 上限 8）。 */
function pushList(el: Element, d: Docx, out: Block[], level: number): void {
  Array.from(el.children).forEach((li) => {
    if (li.tagName.toLowerCase() !== 'li') return;
    const runs: InstanceType<Docx['TextRun']>[] = [];
    li.childNodes.forEach((n) => {
      if (n.nodeType === 1) {
        const t = (n as HTMLElement).tagName.toLowerCase();
        if (t === 'ul' || t === 'ol') return; // 嵌套列表在下面递归
      }
      collectRuns(n, d, {}, runs);
    });
    out.push(new d.Paragraph({ children: runs.length ? runs : [new d.TextRun('')], bullet: { level: Math.min(level, 8) } }));
    Array.from(li.children).forEach((c) => {
      const t = c.tagName.toLowerCase();
      if (t === 'ul' || t === 'ol') pushList(c, d, out, level + 1);
    });
  });
}

function blockOf(el: Element, d: Docx, out: Block[]): void {
  const tag = el.tagName.toLowerCase();
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) {
    out.push(new d.Paragraph({ heading: d.HeadingLevel[HEADINGS[Number(heading[1]) - 1]], children: runsOf(el, d) }));
  } else if (tag === 'p') {
    out.push(new d.Paragraph({ children: runsOf(el, d) }));
  } else if (tag === 'ul' || tag === 'ol') {
    pushList(el, d, out, 0);
  } else if (tag === 'blockquote') {
    Array.from(el.children).forEach((inner) =>
      out.push(new d.Paragraph({ children: runsOf(inner, d, { italics: true }), indent: { left: 360 } })),
    );
  } else if (tag === 'pre') {
    // 保留代码块换行：逐行 TextRun，行间 break:1（同 collectRuns 处理 <br>）。
    const runs: InstanceType<Docx['TextRun']>[] = [];
    (el.textContent ?? '').split('\n').forEach((line, i) => {
      if (i > 0) runs.push(new d.TextRun({ text: '', break: 1 }));
      runs.push(new d.TextRun({ text: line, font: 'Consolas' }));
    });
    out.push(new d.Paragraph({ children: runs.length ? runs : [new d.TextRun({ text: '', font: 'Consolas' })] }));
  } else if (tag === 'hr') {
    out.push(new d.Paragraph({ thematicBreak: true }));
  } else if (tag === 'table') {
    out.push(tableOf(el, d));
  } else {
    const t = el.textContent?.trim();
    if (t) out.push(new d.Paragraph({ children: [new d.TextRun(t)] }));
  }
}

/** 正文 HTML + 元数据 → DOCX Blob。 */
export async function htmlToDocxBlob(bodyHtml: string, meta: ExportMeta): Promise<Blob> {
  const d = await import('docx');
  const dom = new DOMParser().parseFromString(`<div>${bodyHtml}</div>`, 'text/html');
  const container = dom.body.firstElementChild;
  const blocks: Block[] = [];
  if (container) Array.from(container.children).forEach((el) => blockOf(el, d, blocks));

  const footers = meta.brandingFooter
    ? {
        default: new d.Footer({
          children: [
            new d.Paragraph({
              alignment: d.AlignmentType.CENTER,
              children: [new d.TextRun({ text: 'Made with InkStream', color: '8C959F', size: 16 })],
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
