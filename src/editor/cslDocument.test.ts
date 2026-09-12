import { describe, expect, it } from 'vitest';
import type { CslItem } from '../types/zotero';
import { parseCitationDocument } from './citationDocument';
import { formatCitationDocument } from './cslFormat';

const item = (key: string, title = key): CslItem => ({
  'citation-key': key, type: 'book', title, author: [{ family: 'Alpha', given: 'Anne' }],
  publisher: 'Example Press', issued: { 'date-parts': [[2020]] },
});
const plain = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

describe('the pinned CSL processor owns every citation and bibliography in one document', () => {
  it.each(['gbt7714', 'vancouver'] as const)('%s numbering spans paragraphs and repeated references reuse the original number', async (style) => {
    const model = parseCitationDocument('[@b]\n\n[@a]\n\n[@b; @c]\n\n[@a]');
    const result = await formatCitationDocument([item('c', 'Third reference'), item('a', 'Second reference'), item('b', 'First reference')], model.clusters, style);
    const numbers = result.citations.map((citation) => plain(citation.html).match(/\d+/g));
    expect(numbers).toEqual([['1'], ['2'], ['1', '3'], ['2']]);
    expect(result.bibliography.indexOf('First reference')).toBeLessThan(result.bibliography.indexOf('Second reference'));
    expect(result.bibliography.indexOf('Second reference')).toBeLessThan(result.bibliography.indexOf('Third reference'));
    expect(result.citations[1].html).toBe(result.citations[3].html);
  });

  it('APA citations and bibliography use the same global same-author/year disambiguation', async () => {
    const model = parseCitationDocument('[@later]\n\n[@earlier]\n\n[@later]');
    const result = await formatCitationDocument([item('later', 'Zebra book'), item('earlier', 'Alpha book')], model.clusters, 'apa');
    expect(plain(result.citations[0].html)).toContain('2020b');
    expect(plain(result.citations[1].html)).toContain('2020a');
    expect(result.citations[0].html).toBe(result.citations[2].html);
    expect(result.bibliography).toContain('(2020a)');
    expect(result.bibliography).toContain('(2020b)');
  });

  it('group locators and prefixes are passed through the style processor', async () => {
    const model = parseCitationDocument('[see @alpha, p. 42]');
    const result = await formatCitationDocument([item('alpha')], model.clusters, 'apa');
    expect(plain(result.citations[0].html)).toContain('see');
    expect(plain(result.citations[0].html)).toContain('42');
  });

  it('a missing reference rejects the whole result instead of renumbering the surviving subset', async () => {
    const model = parseCitationDocument('[@missing]\n\n[@known]');
    await expect(formatCitationDocument([item('known')], model.clusters, 'gbt7714')).rejects.toThrow('missing');
  });
});
