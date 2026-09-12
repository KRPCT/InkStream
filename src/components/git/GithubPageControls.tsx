export default function GithubPageControls({ page, next, loading, onPage }: {
  page: number; next: number | null; loading: boolean; onPage: (page: number) => void;
}) {
  return <nav aria-label="GitHub 分页" className="flex shrink-0 items-center gap-2 border-t border-[var(--background-modifier-border)] p-2 text-[12px]">
    <button type="button" disabled={loading || page <= 1} onClick={() => onPage(page - 1)} className="underline disabled:opacity-40">上一页</button>
    <span>第 {page} 页</span>
    <button type="button" disabled={loading || next === null} onClick={() => next !== null && onPage(next)} className="underline disabled:opacity-40">下一页</button>
  </nav>;
}
