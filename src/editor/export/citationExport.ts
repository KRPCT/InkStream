import { zoteroCslResilient } from '../../ipc/zotero';
import { parseCitationDocument } from '../citationDocument';
import { formatCitationDocument } from '../cslFormat';
import { bibliographyHtmlToMarkdown } from '../csl/markdown';

/** Produce a disposable export snapshot; the live document and saved source stay untouched. */
export async function renderCitationsForExport(markdown: string, language: string): Promise<string> {
  if (!markdown.includes('@')) return markdown;
  const model = parseCitationDocument(markdown, language);
  if (!['markdown', 'richtext'].includes(model.language) || !model.clusters.length) return markdown;
  const items = await zoteroCslResilient(model.citations.map((citation) => citation.key));
  const formatted = await formatCitationDocument(items, model.clusters, model.style);
  const changes = formatted.citations.map((citation) => ({ from: citation.from, to: citation.to, insert: bibliographyHtmlToMarkdown(citation.html) }));
  const region = model.bibliography;
  if (region && region.to > region.markerTo) {
    changes.push({ from: region.from, to: region.to, insert: `${markdown.slice(region.from, region.markerTo)}\n\n${formatted.bibliography}\n\n<!-- /biblio -->` });
  }
  const parts: string[] = [];
  let from = 0;
  for (const change of changes.sort((a, b) => a.from - b.from)) {
    parts.push(markdown.slice(from, change.from), change.insert);
    from = change.to;
  }
  parts.push(markdown.slice(from));
  return parts.join('');
}
