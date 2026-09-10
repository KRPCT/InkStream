import { FileText } from 'lucide-react';
import { useCallback } from 'react';
import { openFileAndLocate, openFileByPath } from '../../editor/fileOpenFlow';
import { findReferenceRange } from '../../editor/wikiReferences';
import { queryBacklinkReferences, queryUnlinkedMentions, type BacklinkReference } from '../../ipc/indexService';
import { useEditorStore } from '../../stores/useEditorStore';
import { showToast } from '../../stores/useToastStore';
import EmptyState from '../common/EmptyState';
import IndexQueryMessage from './IndexQueryMessage';
import { useIndexQuery } from './useIndexQuery';

/**
 * 反链面板（Phase 4 W4 / LINK-05）：当前文件的「反向链接」（哪些笔记 `[[]]` 引用了它）+「未链接提及」
 * （正文提到文件名却未建链的笔记）。数据经 ipc/indexService 的 plugin-sql 只读连接查 links / files_fts。
 * 每处反链显示来源段落，点击后按当前正文重定位；未链接提及保留文件级打开。
 */

/** 取相对路径末段文件名。 */
function fileName(path: string): string {
  const segs = path.split('/');
  return segs[segs.length - 1] || path;
}

/** 单条可点文件行（标题=文件名，副标题=相对路径，点击跳转）。 */
function LinkRow({ path, reference }: { path: string; reference?: BacklinkReference }) {
  const name = fileName(path);
  const open = (): void => {
    if (!reference) { void openFileByPath(path); return; }
    let missing = false;
    void openFileAndLocate(path, (state) => {
      const range = findReferenceRange(state.doc.toString(), reference);
      missing = range === null;
      return range;
    }).then((located) => {
      if (!located && missing) showToast('warning', '引用已变化或存在相同段落，请在来源文件中确认位置。');
    }).catch(() => showToast('error', '无法打开或定位引用来源，请重试。'));
  };
  return (
    <button
      type="button"
      onClick={open}
      className="flex w-full flex-col items-start gap-0.5 rounded-[4px] px-3 py-1.5 text-left hover:bg-[var(--background-modifier-hover)]"
    >
      <span className="w-full truncate text-[13px] text-[var(--text-normal)]">{name}</span>
      {name !== path ? (
        <span className="w-full truncate text-[12px] text-[var(--text-muted)]">{path}</span>
      ) : null}
      {reference ? (
        <span className="line-clamp-3 whitespace-pre-line break-words text-[12px] text-[var(--text-muted)]">{reference.context}</span>
      ) : null}
    </button>
  );
}

/** 分组（标题 + 行）；空组不渲染。 */
function Section({ title, paths = [], references }: { title: string; paths?: string[]; references?: BacklinkReference[] }) {
  const count = references?.length ?? paths.length;
  if (count === 0) return null;
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-[12px] font-semibold text-[var(--text-muted)]">
        {title}（{count}）
      </div>
      {references
        ? references.map((reference) => <LinkRow key={`${reference.sourcePath}:${reference.from}`} path={reference.sourcePath} reference={reference} />)
        : paths.map((path) => <LinkRow key={path} path={path} />)}
    </div>
  );
}

export default function BacklinksPanel() {
  const activePath = useEditorStore((s) => s.activePath);
  const load = useCallback(async () => {
    if (!activePath) return { backlinks: [], mentions: [] };
    const [backlinks, mentions] = await Promise.all([queryBacklinkReferences(activePath), queryUnlinkedMentions(activePath)]);
    return { backlinks, mentions };
  }, [activePath]);
  const query = useIndexQuery(load, activePath !== null);
  if (activePath && (query.loading || query.error || query.disabled)) return <IndexQueryMessage {...query} />;
  const { backlinks, mentions } = query.data ?? { backlinks: [], mentions: [] };

  if (backlinks.length === 0 && mentions.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        heading="暂无反向链接"
        body="当其他笔记引用当前文件时，引用会列在这里。"
      />
    );
  }

  return (
    <div className="h-full overflow-auto py-1">
      <Section title="反向链接" references={backlinks} />
      <Section title="未链接提及" paths={mentions} />
    </div>
  );
}
