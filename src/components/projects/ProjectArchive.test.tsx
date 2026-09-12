import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getView, setView } from '../../editor/viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import { useProjectStore } from '../../stores/useProjectStore';
import type { ProjectRecord } from '../../types/projects';
import ProjectArchive from './ProjectArchive';

const actions = vi.hoisted(() => ({
  openProject: vi.fn(), addProjectDirectory: vi.fn(), importProjectCover: vi.fn(), recoverProjectBackup: vi.fn(),
  relocateProject: vi.fn(), removeProject: vi.fn(), renameProject: vi.fn(), retryProjectSnapshot: vi.fn(), setProjectFavorite: vi.fn(),
}));
vi.mock('../../projects/actions', () => actions);
const project = (id: string, name: string, favorite: boolean): ProjectRecord => ({ id, name, root: `C:/writing/${id}`, favorite, cover: null, createdAt: 1, lastOpenedAt: 1, removed: false });
const first = project('first', '第一份手稿', true);
const second = project('second', '第二个项目', false);
let view: EditorView;
beforeEach(() => {
  vi.clearAllMocks();
  actions.openProject.mockResolvedValue(true);
  useProjectStore.setState({ catalog: { version: 1, activeId: 'second', projects: [first, second] }, activeId: 'first', ready: true, phase: 'idle', archiveOpen: true, error: null, snapshotStatus: 'idle', snapshotError: null });
  useEditorStore.setState({ activePath: 'draft://current', tabs: [{ path: 'draft://current', name: '未命名' }] });
  view = new EditorView({ state: EditorState.create({ doc: '未保存的真实文稿', selection: { anchor: 3 } }) });
  document.body.appendChild(view.dom);
  setView(view);
});
afterEach(() => { cleanup(); setView(null); view.destroy(); view.dom.remove(); });

describe('project archive consumes the project coordinator without replacing the editor', () => {
  it('marks the runtime project instead of the catalog startup preference', () => {
    render(<ProjectArchive />);
    expect(screen.getByRole('button', { name: '打开项目 第一份手稿' }).closest('li')).toHaveAttribute('data-current', 'true');
    expect(screen.getByRole('button', { name: '打开项目 第二个项目' }).closest('li')).toHaveAttribute('data-current', 'false');
  });

  it('keeps the archive and original document on a failed switch', async () => {
    actions.openProject.mockImplementationOnce(async () => { useProjectStore.setState({ error: '当前文稿保存失败' }); return false; });
    const original = view.state;
    render(<ProjectArchive />);
    fireEvent.click(screen.getByRole('button', { name: '打开项目 第二个项目' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('当前文稿保存失败');
    expect(screen.getByRole('dialog', { name: '项目档案' })).toBeVisible();
    expect(view.state).toBe(original);
    expect(getView()).toBe(view);
  });

  it('closes only after the coordinator reports success and keeps the existing EditorView', async () => {
    let complete!: (success: boolean) => void;
    actions.openProject.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const original = view.state;
    render(<ProjectArchive />);
    fireEvent.click(screen.getByRole('button', { name: '打开项目 第二个项目' }));
    expect(screen.getByRole('dialog', { name: '项目档案' })).toBeVisible();
    expect(actions.openProject).toHaveBeenCalledWith('second');
    await act(async () => { complete(true); });
    expect(screen.queryByRole('dialog', { name: '项目档案' })).toBeNull();
    expect(getView()).toBe(view);
    expect(view.state).toBe(original);
  });

  it('searches directories and filters favorites without opening a project', () => {
    render(<ProjectArchive />);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索项目档案' }), { target: { value: 'writing/second' } });
    expect(screen.queryByRole('button', { name: '打开项目 第一份手稿' })).toBeNull();
    expect(screen.getByRole('button', { name: '打开项目 第二个项目' })).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索项目档案' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '收藏' }));
    expect(screen.getByRole('button', { name: '打开项目 第一份手稿' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '打开项目 第二个项目' })).toBeNull();
    expect(actions.openProject).not.toHaveBeenCalled();
  });

  it('edits project metadata through the facade without changing the active document', async () => {
    render(<ProjectArchive />);
    fireEvent.click(screen.getByRole('button', { name: '管理项目 第二个项目' }));
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), { target: { value: '重新命名' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await waitFor(() => expect(actions.renameProject).toHaveBeenCalledWith('second', '重新命名'));
    expect(actions.openProject).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('未保存的真实文稿');
  });

  it('Escape closes the selector and leaves the document untouched', () => {
    render(<ProjectArchive />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '搜索项目档案' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(view.state.doc.toString()).toBe('未保存的真实文稿');
  });

  it('an unavailable previous directory does not prevent choosing a healthy project or independent drafts', async () => {
    useProjectStore.setState({ ready: false, error: '上次目录不可用' });
    render(<ProjectArchive />);
    expect(screen.getByRole('button', { name: '添加项目文件夹' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '打开项目 第二个项目' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '独立草稿' }));
    await waitFor(() => expect(actions.openProject).toHaveBeenCalledWith(null));
  });
});
