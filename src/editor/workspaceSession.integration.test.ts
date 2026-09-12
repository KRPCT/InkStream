import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectIO, projectFixture, PROJECT_IDS, setupProjectSessionFixture, teardownProjectSessionFixture } from '../test/projectSessionFixture';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useProjectStore } from '../stores/useProjectStore';
import { openProjectSession } from '../projects/session';
import { createFileTreeOps } from '../components/workbench/fileTreeOps';
import { createFile } from '../ipc/files';

beforeEach(setupProjectSessionFixture);
afterEach(teardownProjectSessionFixture);

describe('project-scoped workspace transition acceptance', () => {
  it('目标文件清单失败保留原项目、完整正文和原监听', async () => {
    projectIO.files.mockRejectedValueOnce(new Error('directory unavailable'));
    expect(await openProjectSession(PROJECT_IDS['/B'])).toBe(false);
    expect(useVaultStore.getState().vault?.root).toBe('/A');
    expect(useProjectStore.getState().activeId).toBe(PROJECT_IDS['/A']);
    expect(projectFixture.watch).toBe('/A');
    expect(projectFixture.view!.state.doc.toString()).toBe('A 的完整正文');
    expect(projectIO.stop).not.toHaveBeenCalled();
  });
  it('项目切换期间排队的旧文件创建不能写入目标项目', async () => {
    let ready!: () => void;
    projectIO.files.mockImplementation(async (root: string) => {
      if (root === '/B') await new Promise<void>((resolve) => { ready = resolve; });
      return [];
    });
    const switching = openProjectSession(PROJECT_IDS['/B']);
    await vi.waitFor(() => expect(ready).toBeTypeOf('function'));
    const creating = createFileTreeOps().create({ parentPath: '', name: 'queued', isDir: false });
    ready(); await Promise.all([switching, creating]);
    expect(createFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs).toEqual([]);
    expect(useVaultStore.getState().vault?.root).toBe('/B');
    expect(projectFixture.sessions.get(PROJECT_IDS['/A'])?.snapshot?.documents[0].path).toBe('same.md');
  });
  it('目标目录无法打开时保留原文档与监听', async () => {
    projectIO.open.mockRejectedValueOnce(new Error('missing directory'));
    expect(await openProjectSession(PROJECT_IDS['/missing'])).toBe(false);
    expect(useVaultStore.getState().vault?.root).toBe('/A');
    expect(projectFixture.watch).toBe('/A');
    expect(projectFixture.view!.state.doc.toString()).toBe('A 的完整正文');
  });
  it('完整准备目标后才发布，后续切换请求按同一会话队列完成', async () => {
    let ready!: () => void;
    projectIO.files.mockImplementation(async (root: string) => {
      if (root === '/B') await new Promise<void>((resolve) => { ready = resolve; });
      return [{ path: root.slice(1) + '.md', name: root.slice(1) + '.md' }];
    });
    const first = openProjectSession(PROJECT_IDS['/B']);
    await vi.waitFor(() => expect(ready).toBeTypeOf('function'));
    expect(useVaultStore.getState().vault?.root).toBe('/A');
    expect(projectFixture.view!.state.doc.toString()).toBe('A 的完整正文');
    const second = openProjectSession(PROJECT_IDS['/C']);
    ready(); await Promise.all([first, second]);
    expect(useVaultStore.getState().vault).toMatchObject({ root: '/C', projectId: PROJECT_IDS['/C'] });
    expect(useVaultStore.getState().files[0]?.path).toBe('C.md');
    expect(projectFixture.watch).toBe('/C');
    expect(useEditorStore.getState().tabs).toEqual([]);
  });
  it('目标监听启动失败会恢复旧监听和旧编辑会话，失败不伪装成功', async () => {
    projectIO.start.mockImplementation(async (root: string) => {
      if (root === '/B') throw new Error('watch unavailable');
      projectFixture.watch = root;
    });
    expect(await openProjectSession(PROJECT_IDS['/B'])).toBe(false);
    expect(useVaultStore.getState().vault?.root).toBe('/A');
    expect(projectFixture.watch).toBe('/A');
    expect(projectFixture.view!.state.doc.toString()).toBe('A 的完整正文');
    expect(useProjectStore.getState().error).toContain('watch unavailable');
  });
});