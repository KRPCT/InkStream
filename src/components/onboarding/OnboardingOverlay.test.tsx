import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGELOG } from '../../data/changelog';
import { initOnboarding, useOnboardingStore } from '../../stores/useOnboardingStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useWhatsNewStore } from '../../stores/useWhatsNewStore';
import WhatsNewDialog from '../common/WhatsNewDialog';
import ProjectArchive from '../projects/ProjectArchive';
import OnboardingOverlay from './OnboardingOverlay';

vi.mock('../common/Celebration', () => ({ default: () => null }));
vi.mock('../../projects/actions', () => ({
  openProject: vi.fn(), addProjectDirectory: vi.fn(), importProjectCover: vi.fn(), recoverProjectBackup: vi.fn(),
  relocateProject: vi.fn(), removeProject: vi.fn(), renameProject: vi.fn(), retryProjectSnapshot: vi.fn(), setProjectFavorite: vi.fn(),
}));

beforeEach(() => {
  localStorage.removeItem('inkstream.onboarded');
  useOnboardingStore.setState({ active: false, step: 0 });
  useWhatsNewStore.setState({ open: false, entry: null, celebrate: false });
  useProjectStore.setState({ catalog: { version: 1, activeId: null, projects: [] }, activeId: null, ready: true, phase: 'idle', archiveOpen: false, error: null, snapshotStatus: 'idle', snapshotError: null });
});

describe('onboarding yields to project startup and recovery', () => {
  it('keeps recovery controls available and waits until the archive closes and the workspace is ready', () => {
    useProjectStore.setState({ ready: false, phase: 'loading', archiveOpen: true });
    initOnboarding();
    render(<><ProjectArchive /><OnboardingOverlay /></>);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: '项目档案' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: '新手引导' })).toBeNull();

    act(() => useProjectStore.setState({ phase: 'idle', error: '项目档案恢复失败' }));
    expect(screen.getByRole('alert')).toHaveTextContent('项目档案恢复失败');
    expect(screen.getByRole('button', { name: '恢复项目档案备份' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: '搜索项目档案' })).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: '新手引导' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭项目档案' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useOnboardingStore.getState().active).toBe(true);
    expect(localStorage.getItem('inkstream.onboarded')).toBeNull();

    act(() => useProjectStore.setState({ ready: true, error: null, archiveOpen: true }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: '新手引导' })).toBeNull();
    act(() => useProjectStore.setState({ archiveOpen: false, phase: 'restoring' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useProjectStore.setState({ phase: 'idle' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: '新手引导' })).toBeVisible();
    expect(screen.getByText('欢迎使用 InkStream')).toBeVisible();
    expect(localStorage.getItem('inkstream.onboarded')).toBeNull();
  });

  it('resumes the current guide step after opening and closing project archives', () => {
    initOnboarding();
    render(<><ProjectArchive /><OnboardingOverlay /></>);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    act(() => useProjectStore.getState().setArchiveOpen(true));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: '项目档案' })).toBeVisible();
    expect(useOnboardingStore.getState().step).toBe(1);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '搜索项目档案' }), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '新手引导' })).toBeVisible();
    expect(screen.getByText('源代码管理面板')).toBeVisible();
    expect(localStorage.getItem('inkstream.onboarded')).toBeNull();
  });

  it('allows the help action to reopen a completed guide after project recovery', () => {
    useOnboardingStore.getState().finish();
    useProjectStore.setState({ ready: false });
    mount();
    act(() => useOnboardingStore.getState().start());
    expect(screen.queryByRole('dialog', { name: '新手引导' })).toBeNull();
    act(() => useProjectStore.setState({ ready: true }));
    expect(screen.getByRole('dialog', { name: '新手引导' })).toBeVisible();
    expect(screen.getByText('欢迎使用 InkStream')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '跳过' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useOnboardingStore.getState().start());
    expect(screen.getByRole('dialog', { name: '新手引导' })).toBeVisible();
  });
});
afterEach(() => { cleanup(); localStorage.removeItem('inkstream.onboarded'); });

function mount() {
  return render(<><OnboardingOverlay /><WhatsNewDialog /></>);
}

describe('onboarding yields to a visible release announcement', () => {
  it('first launch shows only the announcement, then allows onboarding to advance or be skipped', () => {
    mount();
    act(() => {
      useWhatsNewStore.getState().showFor(CHANGELOG[0].version, null);
      initOnboarding();
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: '更新公告' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: '新手引导' })).toBeNull();
    expect(useOnboardingStore.getState().active).toBe(true);
    expect(localStorage.getItem('inkstream.onboarded')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: '新手引导' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('源代码管理面板')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '跳过' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('inkstream.onboarded')).toBe('1');
  });

  it('a late announcement suspends and resumes the existing onboarding step without marking it complete', () => {
    act(() => initOnboarding());
    mount();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    act(() => useWhatsNewStore.getState().showLatest());
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: '新手引导' })).toBeNull();
    expect(useOnboardingStore.getState().step).toBe(1);
    fireEvent.keyDown(screen.getByRole('dialog', { name: '更新公告' }), { key: 'Escape' });
    expect(screen.getByText('源代码管理面板')).toBeVisible();
    expect(localStorage.getItem('inkstream.onboarded')).toBeNull();
  });

  it('an update does not restart onboarding for a user who already finished it', () => {
    localStorage.setItem('inkstream.onboarded', '1');
    act(() => { initOnboarding(); useWhatsNewStore.getState().showLatest(); });
    mount();
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useOnboardingStore.getState().active).toBe(false);
  });

  it('does not defer onboarding when the announcement has no displayable entry', () => {
    act(() => { initOnboarding(); useWhatsNewStore.setState({ open: true, entry: null }); });
    mount();
    expect(screen.getByRole('dialog', { name: '新手引导' })).toBeVisible();
  });
});
