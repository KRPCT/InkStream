import CSL from 'citeproc';
import type { CitationStyle, CslItem } from '../../types/zotero';
import type { CitationCluster } from '../citationDocument';
import apa from './assets/apa7.csl?raw';
import gbt from './assets/gbt7714-2015.csl?raw';
import vancouver from './assets/vancouver-nlm.csl?raw';
import en from './assets/locales-en-US.xml?raw';
import zh from './assets/locales-zh-CN.xml?raw';

const styles: Record<CitationStyle, string> = { apa, gbt7714: gbt, vancouver };

/** Each rendering has its own registry, numbering and disambiguation state. No runtime network. */
function createProcessor(items: readonly CslItem[], style: CitationStyle) {
  const registry = new Map<string, Record<string, unknown>>();
  const ids = items.map((item, index) => {
    const id = String(item['citation-key'] ?? item.citekey ?? item.id ?? `entry-${index}`);
    if (typeof item.type !== 'string' || !item.type.trim()) throw new Error(`文献「${id}」缺少 CSL 类型，未替换原参考文献。`);
    if (!id.trim() || registry.has(id)) throw new Error(`文献标识「${id}」为空或重复，未替换原参考文献。`);
    registry.set(id, { ...item, id });
    return id;
  });
  const processor = new CSL.Engine({
    retrieveItem: (id) => {
      const item = registry.get(id);
      if (!item) throw new Error(`无法解析文献「${id}」。`);
      return item;
    },
    retrieveLocale: (language) => language.startsWith('zh') ? zh : language.startsWith('en') ? en : false,
  }, styles[style], style === 'gbt7714' ? 'zh-CN' : 'en-US', true);
  processor.setOutputFormat('html');
  processor.updateItems(ids);
  return { processor, ids };
}

function bibliographyOutput(processor: ReturnType<typeof createProcessor>['processor'], count: number): string[] {
  const output = processor.makeBibliography();
  if (!output || output[0].bibliography_errors?.length) throw new Error('参考文献排版失败，原参考文献已保留。');
  if (output[1].length !== count || output[1].some((entry) => entry.includes('CSL STYLE ERROR'))) {
    throw new Error('部分文献没有可排版内容，请检查其元数据。');
  }
  return output[1];
}

export function renderEntries(items: readonly CslItem[], style: CitationStyle): string[] {
  if (!items.length) return [];
  const { processor, ids } = createProcessor(items, style);
  return bibliographyOutput(processor, ids.length);
}

/** One processor owns the entire document, including corrections to earlier clusters. */
export function renderDocument(items: readonly CslItem[], clusters: readonly CitationCluster[], style: CitationStyle): { citations: string[]; bibliography: string[] } {
  if (!clusters.length) return { citations: [], bibliography: [] };
  const byKey = new Map<string, CslItem>();
  for (const item of items) {
    const key = String(item['citation-key'] ?? item.citekey ?? item.id ?? '');
    if (!key || byKey.has(key)) throw new Error(`文献标识「${key}」为空或重复。`);
    byKey.set(key, item);
  }
  const keys = [...new Set(clusters.flatMap((cluster) => cluster.items.map((item) => item.id)))];
  const ordered = keys.map((key) => {
    const item = byKey.get(key);
    if (!item) throw new Error(`未找到引用：${key}。原文已保留。`);
    return { ...item, 'citation-key': key };
  });
  const { processor } = createProcessor(ordered, style);
  const citations = Array.from({ length: clusters.length }, () => '');
  clusters.forEach((cluster, index) => {
    const updates = processor.appendCitationCluster({
      citationID: `citation-${index}`, citationItems: cluster.items.map((item) => ({ ...item })), properties: { noteIndex: 0 },
    });
    for (const [changedIndex, html] of updates) citations[changedIndex] = html;
  });
  if (citations.some((html) => !html || html.includes('CSL STYLE ERROR'))) throw new Error('文内引用排版失败，原文已保留。');
  return { citations, bibliography: bibliographyOutput(processor, ordered.length) };
}
