import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVaultStore } from '../../stores/useVaultStore';
import { useCodexStore } from '../../stores/useCodexStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { refreshCodex } from '../../editor/codex';
import CodexPanel from './CodexPanel';

const disk = vi.hoisted(() => new Map<string, string>());
const read = vi.hoisted(() => vi.fn());
vi.mock('../../ipc/files', () => ({
  readFile: (...args: unknown[]) => read(...args),
  createDir: vi.fn(async () => null),
  writeFileAtomic: vi.fn(async (root: string, path: string, text: string) => { disk.set(root + '/' + path, text); }),
}));
vi.mock('../../ipc/codex', () => ({
  createCodexFile: vi.fn(async (root: string, path: string, text: string) => {
    if (disk.has(root + '/' + path)) throw new Error('同名文件已存在');
    disk.set(root + '/' + path, text);
  }),
}));
vi.mock('../../ipc/indexService', () => ({
  captureIndexScope: () => null, isIndexable: () => false, indexUpsertDoc: vi.fn(async () => {}),
}));
vi.mock('../../ipc/vault', () => ({
  listDir: vi.fn(async (root: string, rel: string) => rel === ''
    ? [{ name: 'Codex', path: 'Codex', isDir: true }]
    : [...disk.keys()].filter((path) => path.startsWith(root + '/Codex/')).map((path) => ({
      name: path.split('/').at(-1), path: path.slice(root.length + 1), isDir: false,
    }))),
  listFiles: vi.fn(async () => []),
}));

beforeEach(() => {
  disk.clear();
  read.mockReset().mockImplementation(async (root: string, path: string) => disk.get(root + '/' + path) ?? '');
  useVaultStore.setState({ vault: { root: '/A', name: 'A', repoRoot: null }, tree: [], files: [] });
  useCodexStore.setState({ entries: [], issues: [], status: 'idle' });
  useEditorStore.setState({ tabs: [], activePath: null, dirty: {}, frozen: {}, externalChanged: {} });
});

describe('Codex user workflow against the file IPC boundary', () => {
  it.each(['character', 'location', 'lore'])('creates %s from the empty panel and reads its persisted name and aliases back', async (type) => {
    render(<CodexPanel />);
    fireEvent.click(screen.getByRole('button', { name: '添加条目' }));
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: type } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '林深' } });
    fireEvent.change(screen.getByLabelText('别名'), { target: { value: '小林, 深哥' } });
    fireEvent.change(screen.getByLabelText('概要'), { target: { value: '主角，守着港口。' } });
    fireEvent.click(screen.getByRole('button', { name: '创建条目' }));
    await waitFor(() => expect(useCodexStore.getState().entries[0]?.name).toBe('林深'));
    expect(useCodexStore.getState().entries[0]).toMatchObject({ type, aliases: ['小林', '深哥'], summary: '主角，守着港口。' });
    expect([...disk.values()][0]).toContain('林深');
    expect(screen.getByRole('button', { name: '打开 林深' })).toBeVisible();
  });

  it('edits metadata without replacing the existing body or unknown frontmatter', async () => {
    disk.set('/A/Codex/林深.md', '---\ntype: character\nname: 林深\nsecret: 保留\n---\n\n不能丢的正文。\n');
    render(<CodexPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑 林深' }));
    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: '林远' } });
    fireEvent.click(screen.getByRole('button', { name: '保存条目' }));
    await waitFor(() => expect(useCodexStore.getState().entries[0]?.name).toBe('林远'));
    expect(disk.get('/A/Codex/林深.md')).toContain('secret: 保留');
    expect(disk.get('/A/Codex/林深.md')).toContain('\n\n不能丢的正文。\n');
  });

  it('does not publish a late A scan after B is active', async () => {
    disk.set('/A/Codex/a.md', '---\ntype: character\nname: A角色\n---\n');
    let finish!: (text: string) => void;
    read.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const scan = refreshCodex('/A');
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    useVaultStore.setState({ vault: { root: '/B', name: 'B', repoRoot: null } });
    await refreshCodex('/B');
    await act(async () => { finish('---\ntype: character\nname: A角色\n---\n'); await scan; });
    expect(useCodexStore.getState().entries).toEqual([]);
  });

  it('refuses duplicate names without discarding the form', async () => {
    disk.set('/A/Codex/old.md', '---\ntype: character\nname: 林深\naliases: 小林\n---\n');
    render(<CodexPanel />);
    await screen.findByRole('button', { name: '打开 林深' });
    fireEvent.click(screen.getByRole('button', { name: '添加条目' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '小林' } });
    fireEvent.click(screen.getByRole('button', { name: '创建条目' }));
    expect(await screen.findByText(/名称或别名与/)).toBeVisible();
    expect(screen.getByLabelText('名称')).toHaveValue('小林');
    expect(disk.size).toBe(1);
  });

  it('preserves an externally changed body while a metadata form was open', async () => {
    const before = '---\ntype: character\nname: 林深\n---\n正文';
    disk.set('/A/Codex/old.md', before);
    render(<CodexPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑 林深' }));
    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: '新名字' } });
    disk.set('/A/Codex/old.md', before + '外部新增。');
    fireEvent.click(screen.getByRole('button', { name: '保存条目' }));
    expect(await screen.findByText(/条目在编辑期间已改变/)).toBeVisible();
    expect(disk.get('/A/Codex/old.md')).toBe(before + '外部新增。');
    expect(screen.getByLabelText('名称')).toHaveValue('新名字');
  });
});
