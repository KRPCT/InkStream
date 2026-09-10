import { describe, expect, it } from 'vitest';
import type { CslItem } from '../types/zotero';
import { formatBibEntry, formatBibliography } from './cslFormat';

// Fixed style integration; provenance and unmodified CSL hashes are in csl/assets/sources.json.
const article: CslItem = {
  type: 'article-journal', title: 'Deep learning', 'container-title': 'Nature',
  'citation-key': 'lecun2015', DOI: '10.1038/nature14539', page: '436-444', volume: '521',
  author: [{ family: 'LeCun', given: 'Yann' }, { family: 'Bengio', given: 'Yoshua' }, { family: 'Hinton', given: 'Geoffrey' }],
  issued: { 'date-parts': [[2015]] },
};
const book: CslItem = {
  type: 'book', title: 'The example book', 'citation-key': 'alpha2020',
  author: [{ family: 'Alpha', given: 'Alice' }], publisher: 'Example Press',
  'publisher-place': 'Beijing', edition: '2', issued: { 'date-parts': [[2020]] },
};
const website: CslItem = {
  type: 'webpage', title: 'Reference data', 'citation-key': 'web2024',
  author: [{ literal: 'Example Organization' }], URL: 'https://example.org/reference',
  issued: { 'date-parts': [[2024, 2, 3]] }, accessed: { 'date-parts': [[2026, 9, 11]] },
};

describe('pinned CSL bibliography styles', () => {
  it('GB/T 7714-2015 retains identifiers, publisher and online access metadata for three entry types', async () => {
    const result = await formatBibliography([article, book, website], 'gbt7714');
    expect(result).toContain('\\[1\\]');
    expect(result).toContain('\\[2\\]');
    expect(result).toContain('\\[3\\]');
    expect(result).toContain('Deep learning\\[J/OL\\]');
    expect(result).toContain('10.1038/nature14539');
    expect(result).toContain('The example book\\[M\\]');
    expect(result).toContain('Example Press');
    expect(result).toContain('Reference data\\[EB/OL\\]');
    expect(result).toContain('2026-09-11');
  });

  it('APA 7 retains emphasis, DOI, edition and corporate author metadata', async () => {
    const result = await formatBibliography([article, book, website], 'apa');
    expect(result).toContain('LeCun, Y., Bengio, Y., & Hinton, G. (2015).');
    expect(result).toContain('*Nature*');
    expect(result).toContain('*521*');
    expect(result).toContain('436–444');
    expect(result).toContain('10.1038/nature14539');
    expect(result).toContain('*The example book*');
    expect(result).toContain('2nd ed.');
    expect(result).toContain('Example Organization.');
    expect(result.indexOf('Alpha')).toBeLessThan(result.indexOf('LeCun'));
  });

  it('Vancouver NLM owns numeric labels, edition and Internet retrieval notation', async () => {
    const result = await formatBibliography([article, book, website], 'vancouver');
    expect(result).toContain('1\\. LeCun Y, Bengio Y, Hinton G.');
    expect(result).toContain('2015;521:436–44.');
    expect(result).toContain('2nd ed.');
    expect(result).toContain('\\[Internet\\]');
    expect(result).toContain('https://example.org/reference');
  });

  it('single-entry formatting uses the same styles without the reference number', async () => {
    const result = await formatBibEntry(article, 'gbt7714');
    expect(result).not.toContain('\\[1\\]');
    expect(result).toContain('Deep learning');
  });

  it('APA same-author same-year entries receive distinct year suffixes', async () => {
    const result = await formatBibliography([book, { ...book, 'citation-key': 'alpha2020b', title: 'Another book' }], 'apa');
    expect(result).toContain('(2020a)');
    expect(result).toContain('(2020b)');
  });

  it('invalid or duplicate entry identities fail before producing partial output', async () => {
    await expect(formatBibliography([{ title: 'Missing type' }], 'apa')).rejects.toThrow('CSL');
    await expect(formatBibliography([article, article], 'gbt7714')).rejects.toThrow('重复');
  });

  it('an empty list returns empty text', async () => {
    expect(await formatBibliography([], 'apa')).toBe('');
  });
});
