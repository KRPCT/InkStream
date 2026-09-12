import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVaultStore } from './useVaultStore';
import { useProjectSearchStore } from './useProjectSearchStore';
import { queryContentPaths } from '../ipc/indexService';

vi.mock('../ipc/indexService', () => ({ queryContentPaths: vi.fn() }));
vi.mock('../ipc/files', () => ({ readFile: vi.fn().mockResolvedValue('范围内的研究方法') }));

beforeEach(() => {
  useProjectSearchStore.getState().clear();
  useVaultStore.setState({ vault: { root: '/A', name: 'A', repoRoot: null } });
});

describe('workspace-scoped search results', () => {
  it('a previous workspace response cannot populate the current workspace', async () => {
    let ready!: (paths: string[]) => void;
    vi.mocked(queryContentPaths).mockReturnValueOnce(new Promise((resolve) => { ready = resolve; }));
    const pending = useProjectSearchStore.getState().run('研究方法');
    useVaultStore.setState({ vault: { root: '/B', name: 'B', repoRoot: null } });
    ready(['note.md']);
    await pending;
    expect(useProjectSearchStore.getState().results).toEqual([]);
    expect(useProjectSearchStore.getState().status).not.toBe('searching');
  });

  it('query failure is visible and cannot be mistaken for successful zero matches', async () => {
    vi.mocked(queryContentPaths).mockRejectedValueOnce(new Error('索引不可用'));
    await expect(useProjectSearchStore.getState().run('研究方法')).resolves.toBeUndefined();
    expect(useProjectSearchStore.getState().status).toBe('error');
  });
});
