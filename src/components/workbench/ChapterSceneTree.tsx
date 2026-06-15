import { useEffect } from 'react';
import { buildChapterTree, STATUS_LABEL, STATUS_TOKEN } from '../../editor/chapterTree';
import { openFileByPath } from '../../editor/fileOpenFlow';
import { useChapterTreeStore } from '../../stores/useChapterTreeStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWordCountStore } from '../../stores/useWordCountStore';

/**
 * Creative 模式章节-场景树（CREA-01）：章=顶层文件夹 / 场景=.md，每场景显示字数 + 状态色点，点击打开。
 * 叠在文件树上方（同 Academic ZoteroLibraryPanel，决策：above）。数据 useChapterTreeStore，vault 根/结构变更重建；
 * 活动场景字数实时叠加 useWordCountStore（编辑即更新，不重读盘）。无章节内容则不渲染（不占位）。
 */
export default function ChapterSceneTree() {
  const root = useVaultStore((s) => s.vault?.root ?? null);
  const tree = useVaultStore((s) => s.tree);
  const chapters = useChapterTreeStore((s) => s.chapters);
  const activePath = useEditorStore((s) => s.activePath);
  const liveCount = useWordCountStore((s) => s.activeCount);

  // vault 根 / 结构（tree 引用）变更时重建；autosave 自激抑制的写不变 tree，故不会每键重建。
  useEffect(() => {
    if (!root) {
      useChapterTreeStore.getState().setChapters([]);
      return;
    }
    let cancelled = false;
    useChapterTreeStore.getState().setLoading(true);
    void buildChapterTree(root)
      .then((c) => {
        if (!cancelled) useChapterTreeStore.getState().setChapters(c);
      })
      .catch(() => {
        if (!cancelled) useChapterTreeStore.getState().setChapters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [root, tree]);

  if (chapters.length === 0) return null;

  return (
    <div className="max-h-[40%] min-h-0 shrink-0 overflow-auto border-b border-[var(--background-modifier-border)] py-1">
      <div className="px-2 py-1 text-[11px] font-semibold tracking-wide text-[var(--text-faint)]">
        章节
      </div>
      {chapters.map((ch) => (
        <div key={ch.path ?? '__loose__'}>
          <div
            className="truncate px-2 py-0.5 text-[12px] font-medium text-[var(--text-muted)]"
            title={ch.name}
          >
            {ch.name}
          </div>
          {ch.scenes.map((sc) => {
            const active = sc.path === activePath;
            const words = active ? liveCount : sc.words;
            return (
              <button
                key={sc.path}
                type="button"
                onClick={() => void openFileByPath(sc.path)}
                title={`${sc.name} · ${STATUS_LABEL[sc.status]} · ${words} 字`}
                className={
                  'flex w-full items-center gap-1.5 py-0.5 pr-2 pl-4 text-left text-[13px] ' +
                  (active
                    ? 'bg-[var(--background-modifier-active)] font-semibold text-[var(--text-normal)]'
                    : 'text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]')
                }
              >
                <span
                  aria-label={STATUS_LABEL[sc.status]}
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: STATUS_TOKEN[sc.status] }}
                />
                <span className="min-w-0 flex-1 truncate">{sc.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-faint)]">
                  {words}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
