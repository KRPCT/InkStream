import type { CitationStyle, CslItem } from '../types/zotero';
import type { CitationCluster } from './citationDocument';

export interface FormattedCitations {
  citations: Array<CitationCluster & { html: string }>;
  bibliography: string;
}

export async function formatCitationDocument(items: readonly CslItem[], clusters: readonly CitationCluster[], style: CitationStyle): Promise<FormattedCitations> {
  if (!clusters.length) return { citations: [], bibliography: '' };
  const [{ renderDocument }, { bibliographyHtmlToMarkdown }] = await Promise.all([import('./csl/engine'), import('./csl/markdown')]);
  const result = renderDocument(items, clusters, style);
  return {
    citations: clusters.map((cluster, index) => ({ ...cluster, html: result.citations[index] })),
    bibliography: result.bibliography.map((html) => bibliographyHtmlToMarkdown(html)).join('\n\n'),
  };
}

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
