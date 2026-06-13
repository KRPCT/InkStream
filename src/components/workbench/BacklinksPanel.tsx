import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openFileByPath } from '../../editor/fileOpenFlow';
import { queryBacklinks, queryUnlinkedMentions } from '../../ipc/indexService';
import { useEditorStore } from '../../stores/useEditorStore';
import EmptyState from '../common/EmptyState';

/**
 * 反链面板（Phase 4 W4 / LINK-05）：当前文件的「反向链接」（哪些笔记 `[[]]` 引用了它）+「未链接提及」
 * （正文提到文件名却未建链的笔记）。数据经 ipc/indexService 的 plugin-sql 只读连接查 links / files_fts。
 * 列表点击 → openFileByPath 单内核打开。空 → 沿用逐 tab 空态文案。
 */

/** 取相对路径末段文件名。 */
function fileName(path: string): string {
  const segs = path.split('/');
  return segs[segs.length - 1] || path;
}

/** 单条可点文件行（标题=文件名，副标题=相对路径，点击跳转）。 */
function LinkRow({ path }: { path: string }) {
  const name = fileName(path);
  return (
    <button
      type="button"
      onClick={() => void openFileByPath(path)}
      className="flex w-full flex-col items-start gap-0.5 rounded-[4px] px-3 py-1.5 text-left hover:bg-[var(--background-modifier-hover)]"
    >
      <span className="w-full truncate text-[13px] text-[var(--text-normal)]">{name}</span>
      {name !== path ? (
        <span className="w-full truncate text-[12px] text-[var(--text-muted)]">{path}</span>
      ) : null}
    </button>
  );
}

/** 分组（标题 + 行）；空组不渲染。 */
function Section({ title, paths }: { title: string; paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-[12px] font-semibold text-[var(--text-muted)]">
        {title}（{paths.length}）
      </div>
      {paths.map((p) => (
        <LinkRow key={p} path={p} />
      ))}
    </div>
  );
}

export default function BacklinksPanel() {
  const activePath = useEditorStore((s) => s.activePath);
  const [backlinks, setBacklinks] = useState<string[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (activePath === null) {
      setBacklinks([]);
      setMentions([]);
      return;
    }
    void (async () => {
      const bl = await queryBacklinks(activePath);
      const um = await queryUnlinkedMentions(activePath);
      if (!cancelled) {
        setBacklinks(bl);
        setMentions(um);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePath]);

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
      <Section title="反向链接" paths={backlinks} />
      <Section title="未链接提及" paths={mentions} />
    </div>
  );
}
