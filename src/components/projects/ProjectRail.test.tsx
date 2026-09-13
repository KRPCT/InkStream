import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useProjectStore } from '../../stores/useProjectStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import type { ProjectRecord } from '../../types/projects';
const open = vi.hoisted(() => vi.fn());
vi.mock('../../projects/actions', () => ({ openProject: open }));
import ProjectRail from './ProjectRail';
const project = (id: string): ProjectRecord => ({ id, name: `项目${id}`, root: `D:/${id}`, favorite: false, cover: null, removed: false, createdAt: 1, lastOpenedAt: 1 });
beforeEach(() => {
  useProjectStore.setState({ phase: 'idle', archiveOpen: false, activeId: 'A', catalog: { version: 1, activeId: 'A', projects: [project('A'), project('B')] } });
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  open.mockReset().mockResolvedValue(false);
});
it('WB-02 项目轨使用完整切换入口，失败保持当前项目并展示档案中的错误', async () => {
  render(<ProjectRail />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '打开项目：项目B' })));
  expect(open).toHaveBeenCalledWith('B');
  expect(useProjectStore.getState().activeId).toBe('A'); expect(useProjectStore.getState().archiveOpen).toBe(true);
  expect(screen.getByRole('button', { name: '打开项目：项目A' })).toHaveAttribute('aria-current', 'true');
});
it('WB-07 两栏开关独立，选中反馈跟随实际折叠状态', () => {
  render(<ProjectRail />);
  const left = screen.getByRole('button', { name: '展开或收起文件导航' });
  const right = screen.getByRole('button', { name: '展开或收起工具面板' });
  fireEvent.click(left);
  expect(left).toHaveAttribute('aria-pressed', 'false'); expect(right).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(right); fireEvent.click(left);
  expect(left).toHaveAttribute('aria-pressed', 'true'); expect(right).toHaveAttribute('aria-pressed', 'false');
});
