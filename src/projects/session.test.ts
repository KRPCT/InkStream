import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectIO, projectFixture, PROJECT_IDS, seedProjectSession, setupProjectSessionFixture, teardownProjectSessionFixture } from '../test/projectSessionFixture';
import { checkpointProject, forgetAcceptedProject, openProjectSession } from './session';
import { useEditorStore } from '../stores/useEditorStore';
import { useProjectStore } from '../stores/useProjectStore';
import { useVaultStore } from '../stores/useVaultStore';
import { nextDraft } from '../editor/draftPath';
import * as editorSession from '../editor/editorState';

beforeEach(setupProjectSessionFixture);
afterEach(() => { teardownProjectSessionFixture(); vi.restoreAllMocks(); });

describe('durable project session handover', () => {
  it('文件保存失败保留当前完整正文、dirty与所有者，未触碰目标/索引/监听', async () => {
    projectFixture.view!.dispatch({ changes: { from: 0, to: projectFixture.view!.state.doc.length, insert: 'A 未保存的完整正文🙂' } });
    useEditorStore.getState().markDirty('same.md');
    projectIO.flush.mockResolvedValueOnce({ kind: 'failed', error: 'fixture denied' });
    expect(await openProjectSession(PROJECT_IDS['/B'])).toBe(false);
    expect(projectFixture.view!.state.doc.toString()).toBe('A 未保存的完整正文🙂');
    expect(useEditorStore.getState().dirty['same.md']).toBe(true);
    expect(useProjectStore.getState().activeId).toBe(PROJECT_IDS['/A']);
    expect(useVaultStore.getState().vault?.root).toBe('/A');
    expect(projectFixture.watch).toBe('/A');
    expect(projectIO.begin).not.toHaveBeenCalled(); expect(projectIO.open).not.toHaveBeenCalled();
    expect(projectIO.quietIndex).not.toHaveBeenCalled(); expect(projectIO.stop).not.toHaveBeenCalled();
  });

  it.each(['begin', 'write', 'commit'] as const)('快照 %s 失败不切走且保留正文，已取得租约时会中止', async (stage) => {
    projectIO[stage].mockRejectedValueOnce(new Error(`fixture ${stage} failed`));
    expect(await openProjectSession(PROJECT_IDS['/B'])).toBe(false);
    expect(projectFixture.view!.state.doc.toString()).toBe('A 的完整正文');
    expect(useProjectStore.getState()).toMatchObject({ activeId: PROJECT_IDS['/A'], snapshotStatus: 'error', error: expect.stringContaining(stage) });
    expect(projectFixture.watch).toBe('/A'); expect(projectIO.open).not.toHaveBeenCalled();
    expect(projectIO.quietIndex).not.toHaveBeenCalled(); expect(projectIO.stop).not.toHaveBeenCalled();
    if (stage !== 'begin') expect(projectIO.abort).toHaveBeenCalledOnce();
  });

  it('草稿持久快照经过丢弃运行时缓存后恢复，草稿编号不与恢复标签冲突', async () => {
    const text = '未命名草稿的完整正文\n中文🙂\n末尾';
    projectFixture.view!.dispatch({ changes: { from: 0, to: projectFixture.view!.state.doc.length, insert: text } });
    useEditorStore.setState({ tabs: [{ path: 'draft://41', name: '未命名-41' }], activePath: 'draft://41', dirty: { 'draft://41': true } });
    await checkpointProject();
    const saved = projectFixture.sessions.get(PROJECT_IDS['/A'])!;
    expect(saved.snapshot?.documents[0].draft).toBe(true);
    expect(projectFixture.content.get(`${saved.root}/${saved.snapshot!.documents[0].contentFile}`)).toBe(text);
    forgetAcceptedProject(PROJECT_IDS['/A']);
    projectFixture.view!.dispatch({ changes: { from: 0, to: projectFixture.view!.state.doc.length, insert: '' } });
    expect(await openProjectSession(PROJECT_IDS['/A'], true)).toBe(true);
    expect(projectFixture.view!.state.doc.toString()).toBe(text);
    expect(useEditorStore.getState().activePath).toBe('draft://41');
    expect(Number(nextDraft().path.slice('draft://'.length))).toBeGreaterThan(41);
  });

  it('两个项目同名文件独立，切回读取自身磁盘并保留另一个项目的快照', async () => {
    seedProjectSession(PROJECT_IDS['/B'], [{ path: 'same.md', text: 'B 旧检查点' }]);
    projectFixture.content.set('/B/same.md', 'B 当前磁盘正文');
    expect(await openProjectSession(PROJECT_IDS['/B'])).toBe(true);
    expect(projectFixture.view!.state.doc.toString()).toBe('B 当前磁盘正文');
    expect(useEditorStore.getState().tabs.map((tab) => tab.path)).toEqual(['same.md']);
    projectFixture.view!.dispatch({ changes: { from: 0, to: projectFixture.view!.state.doc.length, insert: 'B 新编辑' } });
    useEditorStore.getState().markDirty('same.md');
    expect(await openProjectSession(PROJECT_IDS['/A'])).toBe(true);
    expect(projectFixture.view!.state.doc.toString()).toBe('A 的完整正文');
    expect(projectFixture.content.get('/A/same.md')).toBe('A 的完整正文');
    expect(projectFixture.content.get('/B/same.md')).toBe('B 新编辑');
    const saved = projectFixture.sessions.get(PROJECT_IDS['/B'])!;
    expect(projectFixture.content.get(`${saved.root}/${saved.snapshot!.documents[0].contentFile}`)).toBe('B 新编辑');
  });

  it('未保存恢复稿与当前磁盘不同会冻结冲突，不自动覆盖外部正文', async () => {
    seedProjectSession(PROJECT_IDS['/B'], [{ path: 'same.md', text: 'B 未保存恢复稿', dirty: true }]);
    projectFixture.content.set('/B/same.md', 'B 外部新正文');
    expect(await openProjectSession(PROJECT_IDS['/B'])).toBe(true);
    expect(projectFixture.view!.state.doc.toString()).toBe('B 未保存恢复稿');
    expect(useEditorStore.getState()).toMatchObject({ dirty: { 'same.md': true }, frozen: { 'same.md': true }, externalChanged: { 'same.md': true } });
    expect(projectFixture.content.get('/B/same.md')).toBe('B 外部新正文');
  });

  it('缺失原文件使用可靠快照恢复成草稿，而非重新创建原路径', async () => {
    seedProjectSession(PROJECT_IDS['/B'], [{ path: 'missing.md', text: '应保留的恢复内容' }]);
    expect(await openProjectSession(PROJECT_IDS['/B'])).toBe(true);
    expect(projectFixture.view!.state.doc.toString()).toBe('应保留的恢复内容');
    expect(useEditorStore.getState().activePath).toMatch(/^draft:\/\/recovery-/);
    expect(projectFixture.content.has('/B/missing.md')).toBe(false);
  });

  it('已激活目标后编辑安装失败，恢复原正文、监听和启动项目偏好', async () => {
    vi.spyOn(editorSession, 'installEditorSession').mockImplementationOnce(() => { throw new Error('fixture editor install failed'); });
    expect(await openProjectSession(PROJECT_IDS['/B'])).toBe(false);
    expect(projectFixture.view!.state.doc.toString()).toBe('A 的完整正文');
    expect(projectFixture.watch).toBe('/A');
    expect(useVaultStore.getState().vault?.root).toBe('/A');
    expect(useProjectStore.getState().activeId).toBe(PROJECT_IDS['/A']);
    expect(projectIO.activate.mock.calls.map(([id]) => id)).toEqual([PROJECT_IDS['/B'], PROJECT_IDS['/A']]);
  });

  it('有效快照未指定活动标签时选择并准备第一份正文', async () => {
    seedProjectSession(PROJECT_IDS['/B'], [{ path: 'same.md', text: 'B 检查点' }], null);
    projectFixture.content.set('/B/same.md', 'B 当前正文');
    expect(await openProjectSession(PROJECT_IDS['/B'])).toBe(true);
    expect(useEditorStore.getState().activePath).toBe('same.md');
    expect(projectFixture.view!.state.doc.toString()).toBe('B 当前正文');
  });
});
