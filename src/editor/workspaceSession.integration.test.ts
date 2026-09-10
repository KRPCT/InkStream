import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../stores/useEditorStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import { switchVault } from './vaultFlow';
import { createFileTreeOps } from '../components/workbench/fileTreeOps';
import { createFile } from '../ipc/files';

const native = vi.hoisted(() => ({
  watch: null as string | null,
  open: vi.fn(), files: vi.fn(), start: vi.fn(), stop: vi.fn(),
}));
vi.mock('../ipc/vault', () => ({
  openVault: (root: string) => native.open(root),
  listDir: vi.fn().mockResolvedValue([]),
  listFiles: (root: string) => native.files(root),
}));
vi.mock('../ipc/events', () => ({
  startWatch: (root: string) => native.start(root), stopWatch: () => native.stop(),
}));
vi.mock('../ipc/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ipc/files')>()),
  createFile: vi.fn().mockResolvedValue(null),
}));

const info = (root: string) => ({ root, name: root, repoRoot: null });
beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useSettingsStore.setState({ simpleMode: true });
  useVaultStore.setState(useVaultStore.getInitialState(), true);
  useVaultStore.getState().openVault(info('/A'), []);
  native.watch = '/A';
  native.open.mockImplementation(async (root: string) => info(root));
  native.files.mockImplementation(async (root: string) => [{ path: root + '.md', name: root + '.md' }]);
  native.stop.mockImplementation(async () => { native.watch = null; });
  native.start.mockImplementation(async (root: string) => { native.watch = root; });
});

describe('workspace transition acceptance', () => {
  it('a failed target file inventory does not publish an incomplete workspace', async () => {
    native.files.mockRejectedValueOnce(new Error('directory unavailable'));
    await expect(switchVault('/B', { confirmLeave: false })).rejects.toThrow();
    expect(useVaultStore.getState().vault?.root).toBe('/A');
    expect(native.watch).toBe('/A');
  });
  it('a create queued behind a workspace switch cannot create in or activate the new workspace', async () => {
    let ready!: () => void;
    native.files.mockImplementation(async (root: string) => {
      if (root === '/B') await new Promise<void>((resolve) => { ready = resolve; });
      return [];
    });
    const switching = switchVault('/B', { confirmLeave: false });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const creating = createFileTreeOps().create({ parentPath: '', name: 'queued', isDir: false });
    ready();
    await Promise.all([switching, creating]);
    expect(createFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs).toEqual([]);
    expect(useVaultStore.getState().vault?.root).toBe('/B');
  });
  it('an inaccessible target leaves the original workspace and its watcher operational', async () => {
    native.open.mockRejectedValueOnce(new Error('missing directory'));
    await expect(switchVault('/missing', { confirmLeave: false })).rejects.toThrow();
    expect(useVaultStore.getState().vault?.root).toBe('/A');
    expect(native.watch).toBe('/A');
  });

  it('prepares the complete target before publishing, and later requests finish consistently', async () => {
    let ready!: () => void;
    native.files.mockImplementation(async (root: string) => {
      if (root === '/B') await new Promise<void>((resolve) => { ready = resolve; });
      return [{ path: root + '.md', name: root + '.md' }];
    });
    const first = switchVault('/B', { confirmLeave: false });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect.soft(useVaultStore.getState().vault?.root).toBe('/A');
    const second = switchVault('/C', { confirmLeave: false });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    ready();
    await Promise.all([first, second]);
    expect(useVaultStore.getState().vault?.root).toBe('/C');
    expect(useVaultStore.getState().files[0]?.path).toBe('/C.md');
    expect(native.watch).toBe('/C');
  });

  it('does not publish a target whose watcher cannot start', async () => {
    native.start.mockImplementation(async (root: string) => {
      if (root === '/B') throw new Error('watch unavailable');
      native.watch = root;
    });
    await expect(switchVault('/B', { confirmLeave: false })).rejects.toThrow();
    expect(useVaultStore.getState().vault?.root).toBe('/A');
    expect(native.watch).toBe('/A');
  });
});
