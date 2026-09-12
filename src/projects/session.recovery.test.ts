import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectIO, projectFixture, PROJECT_IDS, seedProjectSession, setupProjectSessionFixture, teardownProjectSessionFixture } from '../test/projectSessionFixture';
import { recoverProjectSessionBackup } from './session';
import { getDocForPath } from '../editor/editorState';
import { useEditorStore } from '../stores/useEditorStore';
import { useProjectStore } from '../stores/useProjectStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { StoredProjectSession } from '../types/projects';

beforeEach(setupProjectSessionFixture);
afterEach(teardownProjectSessionFixture);

function versions(id: string, path: string) {
  const desired = seedProjectSession(id, [{ path, text: '明确选中的旧备份🙂', dirty: true }]);
  projectFixture.backups.set(id, structuredClone(desired));
  const current = seedProjectSession(id, [{ path, text: '恢复前已持久化的版本', dirty: true }]);
  current.snapshot!.revision = 2;
  return { desired, current };
}
function body(stored: StoredProjectSession, path: string): string | undefined {
  const document = stored.snapshot?.documents.find((item) => item.path === path);
  return document ? projectFixture.content.get(`${stored.root}/${document.contentFile}`) : undefined;
}
function liveDraft(path: string, text: string): void {
  projectFixture.view!.dispatch({ changes: { from: 0, to: projectFixture.view!.state.doc.length, insert: text } });
  useEditorStore.setState({ tabs: [{ path, name: '正在写的草稿' }], activePath: path, dirty: { [path]: true } });
}

describe('restoring a selected session backup', () => {
  it('恢复选定备份并把不同的live草稿作为独立恢复副本持久化，不丢任一全文', async () => {
    const id = PROJECT_IDS['/A']; const path = 'draft://7';
    versions(id, path);
    liveDraft(path, '刚输入而尚未checkpoint的完整草稿\n中文🙂\n末尾');
    await recoverProjectSessionBackup(id);
    const active = useEditorStore.getState().activePath!;
    expect(active).toMatch(/^draft:\/\/recovery-/);
    expect(useEditorStore.getState().tabs.map((tab) => tab.path)).toEqual([path, active]);
    expect(getDocForPath(path)).toBe('明确选中的旧备份🙂');
    expect(getDocForPath(active)).toBe('刚输入而尚未checkpoint的完整草稿\n中文🙂\n末尾');
    const saved = projectFixture.sessions.get(id)!;
    expect(body(saved, path)).toBe('明确选中的旧备份🙂');
    expect(body(saved, active)).toBe('刚输入而尚未checkpoint的完整草稿\n中文🙂\n末尾');
    expect(projectIO.flush).not.toHaveBeenCalled();
    expect(useProjectStore.getState()).toMatchObject({ activeId: id, phase: 'idle', snapshotStatus: 'saved' });
  });

  it('restore发生在任何新checkpoint之前；恢复后轮换的backup仍是用户选中的那份', async () => {
    const id = PROJECT_IDS['/A']; const path = 'draft://historical';
    const { desired, current } = versions(id, path);
    await recoverProjectSessionBackup(id);
    expect(projectIO.restore).toHaveBeenCalledWith(id, 'session');
    expect(projectIO.begin).toHaveBeenCalledTimes(1);
    expect(projectIO.restore.mock.invocationCallOrder[0]).toBeLessThan(projectIO.begin.mock.invocationCallOrder[0]);
    expect(projectFixture.view!.state.doc.toString()).toBe('明确选中的旧备份🙂');
    expect(projectFixture.backups.get(id)?.snapshot).toEqual(desired.snapshot);
    const preserved = projectFixture.preserved.get(id)!;
    expect(preserved).toHaveLength(1);
    expect(preserved[0].snapshot).toEqual(current.snapshot);
    expect(body(preserved[0], path)).toBe('恢复前已持久化的版本');
    expect(body(projectFixture.backups.get(id)!, path)).toBe('明确选中的旧备份🙂');
  });

  it('恢复后的commit失败保留原live正文与dirty，原持久化版本及备份正文仍可读', async () => {
    const id = PROJECT_IDS['/A']; const path = 'draft://9';
    const { desired } = versions(id, path);
    liveDraft(path, '不能丢的live修改🙂');
    projectIO.commit.mockRejectedValueOnce(new Error('fixture recovery commit denied'));
    await expect(recoverProjectSessionBackup(id)).rejects.toThrow('recovery commit denied');
    expect(projectFixture.view!.state.doc.toString()).toBe('不能丢的live修改🙂');
    expect(useEditorStore.getState()).toMatchObject({ activePath: path, dirty: { [path]: true } });
    expect(useProjectStore.getState()).toMatchObject({ activeId: id, phase: 'idle', snapshotStatus: 'error', error: expect.stringContaining('commit denied') });
    expect(projectFixture.sessions.get(id)?.snapshot).toEqual(desired.snapshot);
    expect(body(projectFixture.sessions.get(id)!, path)).toBe('明确选中的旧备份🙂');
    expect(body(projectFixture.preserved.get(id)![0], path)).toBe('恢复前已持久化的版本');
    expect(projectIO.abort).toHaveBeenCalledOnce();
    expect(projectFixture.watch).toBe('/A');
  });

  it('恢复非活动项目只替换其native会话，不动当前项目编辑器或发布当前checkpoint', async () => {
    const id = PROJECT_IDS['/B']; const path = 'draft://other'; versions(id, path);
    const beforeVault = useVaultStore.getState().vault;
    await recoverProjectSessionBackup(id);
    expect(projectFixture.view!.state.doc.toString()).toBe('A 的完整正文');
    expect(useVaultStore.getState().vault).toBe(beforeVault);
    expect(useProjectStore.getState().activeId).toBe(PROJECT_IDS['/A']);
    expect(body(projectFixture.sessions.get(id)!, path)).toBe('明确选中的旧备份🙂');
    expect(projectIO.begin).not.toHaveBeenCalled(); expect(projectIO.commit).not.toHaveBeenCalled();
  });
});
