import type { CitationStyle, CslItem, CslName } from '../types/zotero';

/**
 * 参考文献条目渲染（Phase 8 ZOT-04）：CSL-JSON → GB/T 7714-2015 / APA 7 / Vancouver 文本。
 * 纯函数（无 I/O、无 view），便于配对单测；输出为 Markdown 串（APA 刊名/书名用 *斜体*）。
 *
 * 标准取舍：覆盖常见条目类型（期刊/会议/图书/章节/学位/网页），力求「形似且可读」，
 * 非逐字符合规排版引擎；Latin 人名取「姓 + 名首字母」，机构名（literal）原样。
 */

/** 名首字母（按空白/连字符/点切分取首字母大写）。"Jean-Paul" → ['J','P']。 */
function initials(given: string): string[] {
  return given
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase());
}

/** 单个作者按样式渲染。APA：`姓, I. I.`；GB/T 与 Vancouver：`姓 II`（首字母连写无点）。 */
function fmtName(n: CslName, style: CitationStyle): string {
  if (n.literal) return n.literal;
  const family = n.family ?? '';
  const ini = initials(n.given ?? '');
  if (!family) return n.given ?? '';
  if (style === 'apa') {
    const dotted = ini.map((i) => `${i}.`).join(' ');
    return dotted ? `${family}, ${dotted}` : family;
  }
  return ini.length ? `${family} ${ini.join('')}` : family;
}

/** 作者列表按样式截断/连接：GB/T >3 取 3 + 等；Vancouver >6 取 6 + et al.；APA 末位前加 &。 */
function fmtNames(authors: CslName[] | undefined, style: CitationStyle): string {
  if (!authors || authors.length === 0) return '';
  const names = authors.map((a) => fmtName(a, style));
  if (style === 'apa') {
    if (names.length === 1) return names[0]!;
    return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]!}`;
  }
  if (style === 'vancouver') {
    return names.length > 6 ? `${names.slice(0, 6).join(', ')}, et al.` : names.join(', ');
  }
  return names.length > 3 ? `${names.slice(0, 3).join(', ')}, 等` : names.join(', ');
}

function year(it: CslItem): string {
  const y = it.issued?.['date-parts']?.[0]?.[0];
  return y == null ? '' : String(y);
}

function isJournal(type?: string): boolean {
  return type === 'article-journal' || type === 'article-magazine' || type === 'article-newspaper';
}

/** GB/T 7714 文献类型标识。 */
const GBT_MARK: Record<string, string> = {
  'article-journal': 'J',
  'article-magazine': 'J',
  'article-newspaper': 'N',
  book: 'M',
  chapter: 'M',
  'paper-conference': 'C',
  thesis: 'D',
  report: 'R',
  patent: 'P',
  dataset: 'DS',
  webpage: 'EB/OL',
  'post-weblog': 'EB/OL',
};

function gbt(it: CslItem): string {
  const a = fmtNames(it.author, 'gbt7714');
  const head = `${a ? `${a}. ` : ''}${it.title ?? ''}[${GBT_MARK[it.type ?? ''] ?? 'Z'}]`;
  const cont = it['container-title'] ?? '';
  const y = year(it);
  const volIssue = (it.volume ?? '') + (it.issue ? `(${it.issue})` : '');
  if (isJournal(it.type)) {
    const tail = volIssue ? `${volIssue}${it.page ? `: ${it.page}` : ''}` : (it.page ?? '');
    const body = [cont, y, tail].filter(Boolean).join(', ');
    return `${head}. ${body}.`;
  }
  if (it.type === 'paper-conference') {
    return `${head}. ${[cont, y].filter(Boolean).join(', ')}.`;
  }
  const pub = [it['publisher-place'], it.publisher].filter(Boolean).join(': ');
  const body = [pub, y].filter(Boolean).join(', ');
  return body ? `${head}. ${body}.` : `${head}.`;
}

function apa(it: CslItem): string {
  const a = fmtNames(it.author, 'apa');
  const head = `${a ? `${a} ` : ''}(${year(it) || 'n.d.'}).`;
  const cont = it['container-title'] ?? '';
  const doi = it.DOI ? ` https://doi.org/${it.DOI}` : it.URL ? ` ${it.URL}` : '';
  if (isJournal(it.type)) {
    const volIssue = (it.volume ? `*${it.volume}*` : '') + (it.issue ? `(${it.issue})` : '');
    const journal = [cont ? `*${cont}*` : '', volIssue, it.page].filter(Boolean).join(', ');
    return `${head} ${it.title ?? ''}. ${journal}.${doi}`;
  }
  if (it.type === 'book') {
    return `${head} *${it.title ?? ''}*.${it.publisher ? ` ${it.publisher}.` : ''}${doi}`;
  }
  return `${head} ${it.title ?? ''}.${cont ? ` *${cont}*.` : ''}${doi}`;
}

function vancouver(it: CslItem): string {
  const a = fmtNames(it.author, 'vancouver');
  const head = a ? `${a}. ` : '';
  const cont = it['container-title'] ?? '';
  const y = year(it);
  if (isJournal(it.type)) {
    const volIssue = (it.volume ?? '') + (it.issue ? `(${it.issue})` : '');
    const meta = `${y}${volIssue ? `;${volIssue}` : ''}${it.page ? `:${it.page}` : ''}`;
    return `${head}${it.title ?? ''}. ${[cont, meta].filter(Boolean).join('. ')}.`;
  }
  return `${head}${it.title ?? ''}. ${[cont, y].filter(Boolean).join('. ')}.`;
}

/** 单条条目按样式渲染。 */
export function formatBibEntry(it: CslItem, style: CitationStyle): string {
  if (style === 'apa') return apa(it);
  if (style === 'vancouver') return vancouver(it);
  return gbt(it);
}

function firstFamily(it: CslItem): string {
  const a = it.author?.[0];
  return (a?.family ?? a?.literal ?? a?.given ?? '').toLowerCase();
}

/**
 * 整段参考文献（条目间空行分隔，各成段）。GB/T 与 Vancouver 按引用顺序加 `[n]` 编号；
 * APA 按首作者姓字母序、无编号。空列表返回空串。
 */
export function formatBibliography(items: CslItem[], style: CitationStyle): string {
  if (items.length === 0) return '';
  const ordered =
    style === 'apa' ? [...items].sort((x, y) => firstFamily(x).localeCompare(firstFamily(y))) : items;
  return ordered
    .map((it, i) => {
      const entry = formatBibEntry(it, style);
      return style === 'apa' ? entry : `[${i + 1}] ${entry}`;
    })
    .join('\n\n');
}
