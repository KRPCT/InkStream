import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const rebaseCurrentOnto = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../editor/gitActions', () => ({
  checkoutTarget: vi.fn(), createBranchAt: vi.fn(), deleteBranchNamed: vi.fn(),
  mergeBranchInto: vi.fn(), pullCurrent: vi.fn(), pushCurrent: vi.fn(), rebaseCurrentOnto,
}));

import { useGitStore } from '../../stores/useGitStore';
import BranchManager from './BranchManager';

beforeEach(() => {
  rebaseCurrentOnto.mockClear();
  useGitStore.setState({ repoRoot: '/repo', branches: [
    { name: 'topic', isRemote: false, isHead: true, ahead: 0, behind: 0, upstream: null, target: 'topic-oid' },
    { name: 'main', isRemote: false, isHead: false, ahead: 0, behind: 0, upstream: null, target: 'main-oid' },
  ] });
});

it('从已有分支管理入口把当前分支变基到选定本地分支', () => {
  render(<BranchManager />);
  fireEvent.click(screen.getByRole('button', { name: '将当前分支变基到此分支' }));
  expect(rebaseCurrentOnto).toHaveBeenCalledWith('main');
});
