import { collectWikiReferences, hasUnlinkedMention } from './wikiReferences';

self.onmessage = (event: MessageEvent<{ doc: string; mention?: string }>) => {
  try {
    const { doc, mention } = event.data;
    const result = mention === undefined ? collectWikiReferences(doc) : hasUnlinkedMention(doc, mention);
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: String(error) }); }
};
