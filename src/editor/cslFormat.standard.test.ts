import { describe, expect, it } from 'vitest';
import { formatBibliography } from './cslFormat';
import type { CslItem } from '../types/zotero';

// NLM published reference example 1: https://www.nlm.nih.gov/bsd/uniform_requirements.html
const nlmArticle: CslItem = {
  type: 'article-journal', title: 'Solid-organ transplantation in HIV-infected patients',
  author: [{ family: 'Halpern', given: 'S. D.' }, { family: 'Ubel', given: 'P. A.' }, { family: 'Caplan', given: 'A. L.' }],
  'container-title': 'N Engl J Med', volume: '347', issue: '4', page: '284-287',
  issued: { 'date-parts': [[2002, 7, 25]] },
};

describe('bibliography rules from published styles', () => {
  it('Vancouver NLM uses the publication date and minimal page range', async () => {
    const result = await formatBibliography([nlmArticle], 'vancouver');
    // NLM publishes ASCII '-' in its example; the pinned CSL locale explicitly uses U+2013.
    expect(result).toContain('Halpern SD, Ubel PA, Caplan AL.');
    expect(result).toContain('2002 Jul 25;347(4):284–7');
    expect(result).not.toContain('284-287');
  });

  // APA 7 author rule is represented by the pinned apa.csl names configuration.
  it('APA 7 prints nineteen authors, an ellipsis and the last author when there are twenty-one', async () => {
    const item: CslItem = {
      type: 'book', title: 'Author limit example', publisher: 'Example Press',
      author: Array.from({ length: 21 }, (_, index) => ({ family: `Surname${index + 1}`, given: 'Alice' })),
      issued: { 'date-parts': [[2025]] },
    };
    const result = await formatBibliography([item], 'apa');
    expect(result).toContain('Surname19');
    expect(result).not.toContain('Surname20');
    expect(result).toContain('Surname21');
    expect(result).toContain('…');
  });

  it('literal Markdown punctuation in bibliographic metadata cannot become markup', async () => {
    const result = await formatBibliography([{ ...nlmArticle, title: 'Literal *asterisks* and [brackets]' }], 'vancouver');
    expect(result).toContain('Literal \\*asterisks\\* and \\[brackets\\]');
  });
});
