import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zoteroCslResilient } from '../../ipc/zotero';
import type { CslItem } from '../../types/zotero';
import { renderCitationsForExport } from './citationExport';

vi.mock('../../ipc/zotero', async (original) => ({ ...await original<typeof import('../../ipc/zotero')>(), zoteroCslResilient: vi.fn() }));
const item = (key: string, title: string): CslItem => ({ 'citation-key': key, type: 'book', title, author: [{ family: 'Author' }], publisher: 'Press', issued: { 'date-parts': [[2024]] } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(zoteroCslResilient).mockResolvedValue([item('a', 'Second reference'), item('b', 'First reference')]);
});

describe('export uses the same whole-document citation result', () => {
  it('formats citations and the existing bibliography together in a disposable snapshot', async () => {
    const source = '[@b]\n\n[@a]\n\n[@b]\n\n<!-- biblio -->\n\nOld bibliography\n\n<!-- /biblio -->';
    const result = await renderCitationsForExport(source, 'markdown');
    expect(result).not.toContain('[@b]');
    expect(result).not.toContain('[@a]');
    expect(result).not.toContain('Old bibliography');
    expect(result.indexOf('First reference')).toBeLessThan(result.indexOf('Second reference'));
    expect(source).toContain('Old bibliography');
    expect(source).toContain('[@b]');
  });

  it('does not rewrite citation syntax or bibliography markers in source examples', async () => {
    const example = '```md\n[@a]\n<!-- biblio:apa -->\n```';
    const result = await renderCitationsForExport(`${example}\n\n[@b]`, 'markdown');
    expect(result).toContain(example);
    expect(zoteroCslResilient).toHaveBeenCalledWith(['b']);
  });

  it('does not export a partially renumbered result when a cited item is missing', async () => {
    await expect(renderCitationsForExport('[@missing] then [@a]', 'markdown')).rejects.toThrow('missing');
  });

  it('retains native source language syntax for the native conversion path', async () => {
    expect(await renderCitationsForExport('#cite(<a>) and @a', 'typst')).toBe('#cite(<a>) and @a');
    expect(zoteroCslResilient).not.toHaveBeenCalled();
  });
});
