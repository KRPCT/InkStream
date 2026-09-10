import type { CitationStyle, CslItem } from '../types/zotero';

/** Load the pinned CSL processor and local styles only when requested. */
export async function formatBibliography(items: readonly CslItem[], style: CitationStyle): Promise<string> {
  if (!items.length) return '';
  const [{ renderEntries }, { bibliographyHtmlToMarkdown }] = await Promise.all([
    import('./csl/engine'), import('./csl/markdown'),
  ]);
  return renderEntries(items, style).map((entry) => bibliographyHtmlToMarkdown(entry)).join('\n\n');
}

/** Single unnumbered entry uses the same processor and representation. */
export async function formatBibEntry(item: CslItem, style: CitationStyle): Promise<string> {
  const [{ renderEntries }, { bibliographyHtmlToMarkdown }] = await Promise.all([
    import('./csl/engine'), import('./csl/markdown'),
  ]);
  return bibliographyHtmlToMarkdown(renderEntries([item], style)[0], true);
}
