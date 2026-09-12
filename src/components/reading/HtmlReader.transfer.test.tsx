import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { readFileBytes } from '../../ipc/files';
import HtmlReader from './HtmlReader';

vi.mock('../../ipc/files', async (original) => ({
  ...await original<typeof import('../../ipc/files')>(),
  readFileBytes: vi.fn(),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('reading transfer lifecycle', () => {
  it('changing documents aborts the previous transfer and only renders the current document', async () => {
    let oldSignal: AbortSignal | undefined;
    let finishOld!: () => void;
    vi.mocked(readFileBytes).mockImplementationOnce((_path, options) => {
      oldSignal = options?.signal;
      return new Promise((resolve) => { finishOld = () => resolve(new TextEncoder().encode('Old reading')); });
    });
    vi.mocked(readFileBytes).mockResolvedValue(new TextEncoder().encode('Current reading'));
    const mounted = render(<HtmlReader doc={{ path: '/old.txt', name: 'old.txt', format: 'txt' }} />);
    mounted.rerender(<HtmlReader doc={{ path: '/new.txt', name: 'new.txt', format: 'txt' }} />);
    await act(async () => { finishOld(); });
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.getByTitle('new.txt')).toHaveAttribute('srcdoc', expect.stringContaining('Current reading'));
    expect(screen.getByTitle('new.txt').getAttribute('srcdoc')).not.toContain('Old reading');
  });
});
