import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arbitrateVaultChange } from '../../editor/externalChange';
import { useConfirmStore } from '../../stores/useConfirmStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { useToastStore } from '../../stores/useToastStore';
import { useVaultStore } from '../../stores/useVaultStore';
import type { VaultInfo } from '../../types/vault';
import ExternalChangeBar from './ExternalChangeBar';

const reloadFromDisk = vi.fn().mockResolvedValue(undefined);

vi.mock('../../editor/editorState', () => ({
  reloadFromDisk: (path: string) => reloadFromDisk(path),
}));

const refreshTree = vi.fn().mockResolvedValue(undefined);

vi.mock('../../editor/vaultFlow', () => ({
  refreshTree: () => refreshTree(),
}));

const freezeAutosave = vi.fn();
const flushAutosave = vi.fn().mockResolvedValue(undefined);
const consumeSuppressedWatch = vi.fn().mockReturnValue(false);

vi.mock('../../stores/autosave', () => ({
  freezeAutosave: (p: string) => freezeAutosave(p),
  flushAutosave: (p: string) => flushAutosave(p),
  consumeSuppressedWatch: (p: string) => consumeSuppressedWatch(p),
}));

const VAULT: VaultInfo = { root: '/v', repoRoot: null, name: 'v' };

function resetStores(): void {
  useVaultStore.setState({ vault: VAULT, tree: [], files: [], expanded: new Set() });
  useEditorStore.setState({
    tabs: [{ path: 'a.md', name: 'a.md' }],
    activePath: 'a.md',
    dirty: {},
    frozen: {},
    cursor: 0,
    isRichtext: false,
    externalChanged: {},
  });
  useToastStore.setState({ toasts: [] });
  useConfirmStore.setState({ request: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  consumeSuppressedWatch.mockReturnValue(false);
  resetStores();
});

afterEach(() => {
  useConfirmStore.setState({ request: null });
});

describe('arbitrateVaultChange (D-04 双路径)', () => {
  it('非打开文件：刷新文件树，不重载不冻结', async () => {
    await arbitrateVaultChange({ path: '/v/other.md', kind: 'modify' });
    expect(refreshTree).toHaveBeenCalled();
    expect(reloadFromDisk).not.toHaveBeenCalled();
    expect(freezeAutosave).not.toHaveBeenCalled();
  });

  it('打开文件 + 干净：静默重载 + Toast，不冻结', async () => {
    await arbitrateVaultChange({ path: '/v/a.md', kind: 'modify' });
    expect(reloadFromDisk).toHaveBeenCalledWith('a.md');
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.message.includes('已自动重载') || t.message.includes('已在外部'))).toBe(
      true,
    );
    expect(freezeAutosave).not.toHaveBeenCalled();
    expect(useEditorStore.getState().externalChanged['a.md']).toBeFalsy();
  });

  it('打开文件 + 脏：freezeAutosave + 标记 externalChanged，不静默重载', async () => {
    useEditorStore.getState().markDirty('a.md');
    await arbitrateVaultChange({ path: '/v/a.md', kind: 'modify' });
    expect(freezeAutosave).toHaveBeenCalledWith('a.md');
    expect(useEditorStore.getState().externalChanged['a.md']).toBe(true);
    expect(reloadFromDisk).not.toHaveBeenCalled();
  });

  it('CR-03：脏的后台（非活动）tab 被外部修改 → freeze + 标记，绝不静默 refreshTree 后被覆盖', async () => {
    // a.md 活动且干净；b.md 在后台打开且脏。外部修改的是后台脏文件 b.md。
    useEditorStore.setState({
      tabs: [
        { path: 'a.md', name: 'a.md' },
        { path: 'b.md', name: 'b.md' },
      ],
      activePath: 'a.md',
      dirty: { 'b.md': true },
      frozen: {},
      externalChanged: {},
    });
    await arbitrateVaultChange({ path: '/v/b.md', kind: 'modify' });
    // 后台脏文件必须冻结 + 标记冲突，切回 b.md 时呈现 ExternalChangeBar（FILE-02/SC#4）。
    expect(freezeAutosave).toHaveBeenCalledWith('b.md');
    expect(useEditorStore.getState().externalChanged['b.md']).toBe(true);
    expect(reloadFromDisk).not.toHaveBeenCalled();
  });

  it('CR-03：干净的后台 tab 被外部修改 → 仍走 refreshTree（无脏冲突）', async () => {
    useEditorStore.setState({
      tabs: [
        { path: 'a.md', name: 'a.md' },
        { path: 'b.md', name: 'b.md' },
      ],
      activePath: 'a.md',
      dirty: {},
      frozen: {},
      externalChanged: {},
    });
    await arbitrateVaultChange({ path: '/v/b.md', kind: 'modify' });
    expect(refreshTree).toHaveBeenCalled();
    expect(freezeAutosave).not.toHaveBeenCalled();
    expect(useEditorStore.getState().externalChanged['b.md']).toBeFalsy();
  });

  it('自激 watcher 事件被 suppressNextWatch 吞：不弹提示条不重载（回归）', async () => {
    consumeSuppressedWatch.mockReturnValue(true);
    useEditorStore.getState().markDirty('a.md');
    await arbitrateVaultChange({ path: '/v/a.md', kind: 'modify' });
    expect(freezeAutosave).not.toHaveBeenCalled();
    expect(reloadFromDisk).not.toHaveBeenCalled();
    expect(useEditorStore.getState().externalChanged['a.md']).toBeFalsy();
  });
});

describe('ExternalChangeBar', () => {
  beforeEach(() => {
    useEditorStore.setState({ externalChanged: { 'a.md': true }, frozen: { 'a.md': true } });
  });

  it('活动文件有外部变更时显示，文案含两按钮（UI-SPEC 字面）', () => {
    render(<ExternalChangeBar />);
    expect(screen.getByRole('button', { name: '重载（丢弃我的修改）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保留我的（覆盖磁盘）' })).toBeInTheDocument();
  });

  it('活动文件无外部变更时不渲染', () => {
    useEditorStore.setState({ externalChanged: {} });
    const { container } = render(<ExternalChangeBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('点「重载」：reloadFromDisk + unfreeze + 清标记', async () => {
    const user = userEvent.setup();
    render(<ExternalChangeBar />);
    await user.click(screen.getByRole('button', { name: '重载（丢弃我的修改）' }));
    expect(reloadFromDisk).toHaveBeenCalledWith('a.md');
    expect(useEditorStore.getState().frozen['a.md']).toBeFalsy();
    expect(useEditorStore.getState().externalChanged['a.md']).toBeFalsy();
  });

  it('点「保留我的」：经二次确认 ConfirmDialog 后 flushAutosave 覆盖 + unfreeze', async () => {
    const user = userEvent.setup();
    render(<ExternalChangeBar />);
    await user.click(screen.getByRole('button', { name: '保留我的（覆盖磁盘）' }));
    // 二次确认弹出
    const req = useConfirmStore.getState().request;
    expect(req).not.toBeNull();
    expect(req?.body).toContain('覆盖');
    req?.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(flushAutosave).toHaveBeenCalledWith('a.md');
    expect(useEditorStore.getState().frozen['a.md']).toBeFalsy();
    expect(useEditorStore.getState().externalChanged['a.md']).toBeFalsy();
  });

  it('「保留我的」二次确认取消：不覆盖磁盘，仍冻结', async () => {
    const user = userEvent.setup();
    render(<ExternalChangeBar />);
    await user.click(screen.getByRole('button', { name: '保留我的（覆盖磁盘）' }));
    useConfirmStore.getState().request?.resolve(false);
    await Promise.resolve();
    expect(flushAutosave).not.toHaveBeenCalled();
    expect(useEditorStore.getState().frozen['a.md']).toBe(true);
  });
});
