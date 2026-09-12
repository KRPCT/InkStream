import { useGitGraphStore } from '../../stores/useGitGraphStore';
import GithubPageControls from './GithubPageControls';

export default function PrChangedFiles() {
  const { prDiff, prPage, filesLoading, filesError, loadPrPage, selectedFile, selectFile } = useGitGraphStore();
  return <section aria-label="PR 变更文件" className="mb-3 rounded border border-[var(--background-modifier-border)] p-2 text-[12px]">
    <h3>变更文件</h3>
    {filesLoading ? <p role="status">读取文件清单…</p> : null}
    {filesError ? <p role="alert">{filesError} <button type="button" onClick={() => loadPrPage(prPage)} className="underline">重试差异</button></p> : null}
    {prDiff?.limited ? <p role="status">GitHub API 最多返回 3000 个文件；此 PR 的清单不完整。请使用本地完整比较。</p> : null}
    {prDiff?.items.map((file) => { const path = file.newPath ?? file.oldPath ?? ''; return <button type="button" key={path} onClick={() => selectFile(path)} aria-pressed={selectedFile === path}
      className="block w-full break-all py-1 text-left underline">{path}</button>; })}
    <GithubPageControls page={prPage} next={prDiff?.nextPage ?? null} loading={filesLoading} onPage={loadPrPage} />
  </section>;
}
