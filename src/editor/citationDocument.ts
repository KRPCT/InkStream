import type { EditorState, Text } from '@codemirror/state';
import { GFM, parser } from '@lezer/markdown';
import type { CitationEntry } from '../stores/useCitationStore';
import type { CitationStyle } from '../types/zotero';
import { documentLanguageHint } from './documentBudget';
import { bodyStart, readLanguage } from './frontmatter';
import { inlineMath } from './livepreview/inlineMath';
import { wikiLink } from './livepreview/wikiLink';

export interface CitationItem {
  id: string;
  prefix?: string;
  suffix?: string;
  locator?: string;
  label?: string;
  'suppress-author'?: boolean;
}
export interface CitationCluster { from: number; to: number; items: CitationItem[] }
export interface BibliographyRegion { from: number; markerTo: number; to: number; style: CitationStyle }
export interface CitationDocument {
  language: string;
  clusters: CitationCluster[];
  citations: CitationEntry[];
  bibliography: BibliographyRegion | null;
  style: CitationStyle;
}
interface Span { from: number; to: number }
const markdown = parser.configure([GFM, wikiLink, inlineMath]);
const excludedMarkdown = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag', 'Image', 'LinkReference', 'Autolink', 'URL', 'Escape', 'WikiLink', 'InlineMath', 'BlockMath']);
const keyPattern = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_:.-]*';
const validKey = new RegExp(`^${keyPattern}$`, 'u');
const cache = new WeakMap<Text, Map<string, CitationDocument>>();

function inSpan(spans: readonly Span[], from: number, to = from + 1): boolean {
  // The arrays are small relative to the document and sorted by source position.
  let low = 0, high = spans.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (spans[mid].to <= from) low = mid + 1;
    else high = mid;
  }
  return low < spans.length && spans[low].from < to;
}

function mergeSpans(spans: Span[]): Span[] {
  const result: Span[] = [];
  for (const span of spans.sort((a, b) => a.from - b.from || a.to - b.to)) {
    const last = result.at(-1);
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else result.push({ ...span });
  }
  return result;
}

function markdownContext(text: string): { excluded: Span[]; bibliography: BibliographyRegion | null } {
  const excluded: Span[] = [];
  const start = bodyStart(text);
  if (start) excluded.push({ from: 0, to: start });
  let bibliography: BibliographyRegion | null = null;
  let closed = false;
  markdown.parse(text).iterate({ enter(node) {
    if (node.to <= start) return false;
    if (node.name === 'Comment' || node.name === 'CommentBlock') {
      const raw = text.slice(node.from, node.to).trimEnd();
      const opening = /^<!--\s*biblio(?::([a-z0-9]+))?\s*-->$/i.exec(raw);
      if (!bibliography && opening) {
        const style = opening[1] === 'apa' || opening[1] === 'vancouver' ? opening[1] : 'gbt7714';
        bibliography = { from: node.from, markerTo: node.from + raw.length, to: node.from + raw.length, style };
      } else if (bibliography && !closed && /^<!--\s*\/biblio\s*-->$/.test(raw)) {
        bibliography.to = node.from + raw.length;
        closed = true;
      }
      excluded.push({ from: node.from, to: node.to });
      return false;
    }
    // Lezer also calls bare bracket text (including [@key]) a Link. Only a
    // destination, an explicit reference label, or () makes it a link here.
    if (node.name === 'Link' && (node.node.getChild('URL') || node.node.getChild('LinkLabel') || node.node.getChildren('LinkMark').length > 2)) {
      excluded.push({ from: node.from, to: node.to });
      return false;
    }
    if (excludedMarkdown.has(node.name)) {
      excluded.push({ from: node.from, to: node.to });
      return false;
    }
    return undefined;
  } });
  if (bibliography) excluded.push(bibliography);
  return { excluded: mergeSpans(excluded), bibliography };
}

/** Only actual Markdown comment markers can own a bibliography edit range. */
export function findBibliographyRegion(text: string): BibliographyRegion | null {
  return markdownContext(text).bibliography;
}

function escaped(text: string, position: number): boolean {
  let count = 0;
  for (let i = position - 1; i >= 0 && text[i] === '\\'; i -= 1) count += 1;
  return count % 2 === 1;
}

function markdownClusters(text: string, excluded: Span[]): CitationCluster[] {
  const clusters: CitationCluster[] = [];
  const brackets: Span[] = [];
  const itemExpression = new RegExp(`^(?:(.*\\s))?(-?)@(${keyPattern})(.*)$`, 'u');
  for (const match of text.matchAll(/\[([^\]\n]*)\]/g)) {
    const from = match.index, to = from + match[0].length;
    if (!match[1].includes('@')) continue;
    brackets.push({ from, to });
    if (escaped(text, from) || inSpan(excluded, from, to)) continue;
    const items: CitationItem[] = [];
    for (const segment of match[1].split(';')) {
      const item = itemExpression.exec(segment.trim());
      if (!item) { items.length = 0; break; }
      if (item[1] && !/\s$/.test(item[1])) { items.length = 0; break; }
      const prefix = (item[1] ?? '').trim();
      const suffix = item[4].trim();
      const locator = /^,?\s*(?:p{1,2}\.?|pages?)\s+(\d[\d–—,\s-]*)(.*)$/i.exec(suffix);
      items.push({
        id: item[3], ...(prefix ? { prefix: prefix + ' ' } : {}),
        ...(item[2] ? { 'suppress-author': true } : {}),
        ...(locator ? { locator: locator[1].trim(), label: 'page', ...(locator[2].trim() ? { suffix: ' ' + locator[2].trim() } : {}) } : suffix ? { suffix: ' ' + suffix } : {}),
      });
    }
    if (items.length) clusters.push({ from, to, items });
  }
  const occupied = mergeSpans([...excluded, ...brackets]);
  const bare = new RegExp(`(^|[\\s;(])@(${keyPattern})`, 'gu');
  for (const match of text.matchAll(bare)) {
    const from = match.index + match[1].length;
    const id = match[2].replace(/[.:]+$/, '');
    const to = from + id.length + 1;
    if (id && !escaped(text, from) && !inSpan(occupied, from, to)) clusters.push({ from, to, items: [{ id }] });
  }
  return clusters.sort((a, b) => a.from - b.from);
}

/** Native source literals have different delimiters from Markdown code examples. */
function nativeExcluded(text: string, language: 'typst' | 'latex'): Span[] {
  const spans: Span[] = [];
  const start = bodyStart(text);
  if (start) spans.push({ from: 0, to: start });
  for (let i = start; i < text.length;) {
    const from = i;
    if ((language === 'latex' && text[i] === '%' && !escaped(text, i)) ||
      (language === 'typst' && text.startsWith('//', i))) {
      const end = text.indexOf('\n', i); i = end < 0 ? text.length : end;
    } else if (language === 'typst' && text.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < text.length && depth) {
        if (text.startsWith('/*', i)) { depth += 1; i += 2; }
        else if (text.startsWith('*/', i)) { depth -= 1; i += 2; }
        else i += 1;
      }
    } else if (language === 'typst' && (text[i] === '`' || text[i] === '"') && !escaped(text, i)) {
      const char = text[i];
      if (char === '`') {
        while (text[i] === '`') i += 1;
        const delimiter = text.slice(from, i), end = text.indexOf(delimiter, i);
        i = end < 0 ? text.length : end + delimiter.length;
      } else {
        i += 1;
        while (i < text.length && (text[i] !== '"' || escaped(text, i))) i += 1;
        i = Math.min(i + 1, text.length);
      }
    } else if (language === 'latex' && text[i] === '\\' && !escaped(text, i)) {
      const environment = /^\\begin\{(verbatim\*?|lstlisting|minted|comment)\}/.exec(text.slice(i));
      const verb = /^\\verb\*?([^\s\w])/.exec(text.slice(i));
      if (environment) {
        const endMark = `\\end{${environment[1]}}`, end = text.indexOf(endMark, i + environment[0].length);
        i = end < 0 ? text.length : end + endMark.length;
      } else if (verb) {
        const end = text.indexOf(verb[1], i + verb[0].length);
        i = end < 0 ? text.length : end + 1;
      } else { i += 1; continue; }
    } else { i += 1; continue; }
    spans.push({ from, to: i });
  }
  return spans;
}

function nativeClusters(text: string, language: 'typst' | 'latex'): CitationCluster[] {
  const excluded = nativeExcluded(text, language);
  const expression = language === 'typst'
    ? /#cite\s*\(\s*<([^>\r\n]+)>\s*(?:,[^\r\n)]*)?\)/g
    : /\\(?:cite[pt]?|autocite|parencite|textcite)\*?(?:\[[^\]\r\n]*\]){0,2}\{([^}\r\n]+)\}/g;
  const clusters: CitationCluster[] = [];
  for (const match of text.matchAll(expression)) {
    if (escaped(text, match.index) || inSpan(excluded, match.index)) continue;
    const keys = match[1].split(',').map((key) => key.trim());
    if (keys.some((key) => !validKey.test(key))) continue;
    clusters.push({ from: match.index, to: match.index + match[0].length, items: keys.map((id) => ({ id })) });
  }
  if (language === 'typst') {
    const callRanges = clusters.map(({ from, to }) => ({ from, to }));
    const labels = new Set<string>();
    for (const match of text.matchAll(/<([^>\r\n]+)>/g)) {
      if (!inSpan(excluded, match.index) && !inSpan(callRanges, match.index) && validKey.test(match[1])) labels.add(match[1]);
    }
    const bare = new RegExp(`(^|[\\s;(])@(${keyPattern})`, 'gu');
    for (const match of text.matchAll(bare)) {
      const from = match.index + match[1].length, id = match[2].replace(/[.:]+$/, '');
      if (id && !labels.has(id) && !escaped(text, from) && !inSpan(excluded, from) && !inSpan(callRanges, from)) {
        clusters.push({ from, to: from + id.length + 1, items: [{ id }] });
      }
    }
    clusters.sort((a, b) => a.from - b.from);
  }
  return clusters;
}

export function parseCitationDocument(text: string, hint = 'markdown'): CitationDocument {
  const language = readLanguage(text) ?? hint;
  const context = language === 'markdown' || language === 'richtext' ? markdownContext(text) : null;
  const clusters = context ? markdownClusters(text, context.excluded)
    : language === 'typst' || language === 'latex' ? nativeClusters(text, language) : [];
  const counts = new Map<string, number>();
  for (const cluster of clusters) for (const item of cluster.items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  return { language, clusters, citations: [...counts].map(([key, count]) => ({ key, count })),
    bibliography: context?.bibliography ?? null, style: context?.bibliography?.style ?? 'gbt7714' };
}

export function citationDocument(state: EditorState): CitationDocument {
  const language = state.facet(documentLanguageHint);
  let byLanguage = cache.get(state.doc);
  if (!byLanguage) { byLanguage = new Map(); cache.set(state.doc, byLanguage); }
  let result = byLanguage.get(language);
  if (!result) { result = parseCitationDocument(state.doc.toString(), language); byLanguage.set(language, result); }
  return result;
}
