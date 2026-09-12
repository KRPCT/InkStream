import { history, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ paths: vi.fn(), read: vi.fn(), flush: vi.fn(), write: vi.fn() }));
vi.mock('../../ipc/indexService', () => ({ queryContentPaths: io.paths, indexRefreshFile: vi.fn(), indexUpsertDoc: vi.fn(), isIndexable: () => true, captureIndexScope: () => null }));
vi.mock('../../ipc/files', async (original) => ({ ...await original<typeof import('../../ipc/files')>(), readFile: io.read }));
vi.mock('../../stores/autosave', () => ({ flushAutosave: io.flush, writeProjectFile: io.write, cancelAutosave: vi.fn(), scheduleAutosave: vi.fn() }));
import { setView } from '../viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useProjectSearchStore } from '../../stores/useProjectSearchStore';
import { replaceAllInProject } from './replaceAll';

let view: EditorView;
beforeEach(() => {
  view = new EditorView({ state: EditorState.create({ doc: '😀研究与研究。', extensions: [history()] }) });
  setView(view);
  useVaultStore.setState({ vault: { root: '/fixture', name: 'fixture', repoRoot: null } });
  useEditorStore.setState({ activePath: '研究.MD', tabs: [{ path: '研究.MD', name: '研究.MD' }], dirty: {}, frozen: {}, externalChanged: {} });
  useProjectSearchStore.getState().clear();
  io.paths.mockReset().mockResolvedValue(['研究.MD']); io.read.mockReset();
  io.flush.mockReset().mockResolvedValue({ kind: 'saved' }); io.write.mockReset();
});
afterEach(() => { useProjectSearchStore.getState().clear(); view.destroy(); setView(null); });

it('真实编辑缓冲上的短中文搜索→替换→撤销，复用原文档而不读取旧磁盘正文', async () => {
  await useProjectSearchStore.getState().run('研究');
  expect(useProjectSearchStore.getState().totalMatches).toBe(2);
  expect(io.read).not.toHaveBeenCalled();
  expect(await replaceAllInProject('研究', '论证')).toEqual({ files: 1, replaced: 2, skipped: [], failed: [] });
  expect(view.state.doc.toString()).toBe('😀论证与论证。');
  expect(io.flush).toHaveBeenCalledWith('研究.MD');
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe('😀研究与研究。');
});
