import { fireEvent, render, screen } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ references: vi.fn(), locate: vi.fn() }));
vi.mock('../../ipc/indexService', () => ({
  queryBacklinks: vi.fn().mockResolvedValue(['notes/来源.md']),
  queryBacklinkReferences: mocks.references,
  queryUnlinkedMentions: vi.fn().mockResolvedValue([]),
  indexRebuild: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../editor/fileOpenFlow', () => ({ openFileByPath: vi.fn(), openFileAndLocate: mocks.locate }));

import { useEditorStore } from '../../stores/useEditorStore';
import { useIndexStore } from '../../stores/useIndexStore';
import BacklinksPanel from './BacklinksPanel';

const first = '😀第一段提到 [[目标文档]]。';
const second = '另一段再次引用 [[目标文档]]。';
const original = `${first}\n\n${second}`;
const references = [first, second].map((context) => {
  const contextFrom = original.indexOf(context);
  const from = contextFrom + context.indexOf('[[');
  return { sourcePath: 'notes/来源.md', targetPath: '目标文档', from, to: from + '[[目标文档]]'.length, contextFrom, context, linkText: '[[目标文档]]' };
});

describe('段落反链', () => {
  beforeEach(() => {
    mocks.references.mockReset().mockResolvedValue(references);
    mocks.locate.mockReset().mockResolvedValue(true);
    useEditorStore.setState({ activePath: '目标文档.md' });
    useIndexStore.setState({ scope: { root: '/fixture', sessionId: 'paragraph' }, status: 'ready', revision: 1, error: null });
  });

  it('同一来源两处引用分别显示段落，不合并成一个文件行', async () => {
    render(<BacklinksPanel />);
    expect(await screen.findByText(first)).toBeInTheDocument();
    expect(screen.getByText(second)).toBeInTheDocument();
    expect(screen.getByText('反向链接（2）')).toBeInTheDocument();
  });

  it('点击后一处引用，在加入前文后的当前正文重新定位 UTF-16 范围', async () => {
    render(<BacklinksPanel />);
    fireEvent.click(await screen.findByText(second));
    expect(mocks.locate).toHaveBeenCalledWith('notes/来源.md', expect.any(Function));
    const locate = mocks.locate.mock.calls[0][1];
    const current = `新插入前文😀\n\n${original}`;
    const from = current.indexOf('[[目标文档]]', current.indexOf(second));
    expect(await locate(EditorState.create({ doc: current }), new AbortController().signal)).toEqual({ from, to: from + '[[目标文档]]'.length });
  });
});
