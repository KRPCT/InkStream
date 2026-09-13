import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useGitStore } from '../../stores/useGitStore';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import { getView } from '../../editor/viewHandle';
import WorkbenchLayout from './WorkbenchLayout';
vi.mock('../../editor/gitActions', async (original) => ({ ...await original<typeof import('../../editor/gitActions')>(), refreshGitAll: async () => {} }));
beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useSettingsStore.setState({ simpleMode: false });
  useProjectStore.setState({ phase: 'idle', archiveOpen: false });
  useGitStore.setState({ repoRoot: null, status: null });
  useGitGraphStore.setState({ repoRoot: null, commits: [], loading: false });
});
it('WB-08 版本空态保留两侧导航及编辑器，返回文稿仍是原视图', () => {
  render(<WorkbenchLayout />);
  const view = getView();
  fireEvent.click(screen.getByRole('tab', { name: '版本' }));
  expect(screen.getByText('项目还没有版本记录。')).toBeVisible();
  expect(screen.getByTestId('sidebar')).toBeVisible(); expect(screen.getByTestId('right-panel')).toBeVisible();
  expect(screen.getByTestId('cm-mount')).not.toBeVisible(); expect(getView()).toBe(view);
  fireEvent.click(screen.getByRole('tab', { name: '文稿' }));
  expect(screen.getByTestId('cm-mount')).toBeVisible(); expect(getView()).toBe(view);
});
it('WB-08 版本列表只展示当前仓库的数据，切换后不显示旧项目的提交', () => {
  useGitStore.setState({ repoRoot: 'D:/A' });
  useGitGraphStore.setState({ repoRoot: 'D:/A', commits: [{ oid: '1234567', summary: '真实仓库的修订', authorName: '测试作者', authorEmail: 'test@example.invalid', authorTime: 1800000000, parents: [], refs: [], body: '' }] });
  render(<WorkbenchLayout />);
  fireEvent.click(screen.getByRole('tab', { name: '版本' }));
  expect(screen.getByText('真实仓库的修订')).toBeVisible();
  act(() => useGitStore.setState({ repoRoot: 'D:/B' }));
  expect(screen.queryByText('真实仓库的修订')).toBeNull();
});
