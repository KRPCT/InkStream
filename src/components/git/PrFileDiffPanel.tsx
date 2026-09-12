import { openExternal } from '../../ipc/opener';
import { githubPrLocalBase } from '../../ipc/githubPage';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import { useGitStore } from '../../stores/useGitStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { showToast } from '../../stores/useToastStore';
import DiffHunkView from './DiffHunkView';

export default function PrFileDiffPanel() {
  const { selectedPr: pr, prDiff, selectedFile, filesLoading, filesError } = useGitGraphStore();
  const file = prDiff?.items.find((item) => (item.newPath ?? item.oldPath) === selectedFile);
  const fullComparison = async () => {
    if (!pr || !prDiff) return;
    const repo = useGitGraphStore.getState().selectedPrRepoRoot;
    const vault = useVaultStore.getState().vault;
    if (!repo || useGitStore.getState().repoRoot !== repo) return;
    const current = () => useGitGraphStore.getState().selectedPr === pr && useGitGraphStore.getState().prDiff === prDiff
      && useGitStore.getState().repoRoot === repo && useVaultStore.getState().vault === vault;
    try {
      const base = await githubPrLocalBase(repo, prDiff.baseOid, prDiff.headOid);
      if (!current()) return;
      const start = { comparison: { from: { name: `${pr.baseRef}（共同祖先）`, oid: base }, to: { name: pr.headRef, oid: prDiff.headOid } }, path: selectedFile };
      useGitGraphStore.getState().setLeftMode('compare');
      useGitGraphStore.setState({ comparisonStart: start });
    } catch (error) { if (current()) showToast('error', String(error)); }
  };
  return <section className="flex h-full flex-col text-[13px]">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--background-modifier-border)] p-2 text-[12px]">
      <button type="button" disabled={!prDiff} onClick={() => void fullComparison()} className="underline disabled:opacity-40">本地完整正文比较</button>
      {pr && <button type="button" onClick={() => void openExternal(prDiff?.webUrl ?? `${pr.url}/files`)} className="underline">在 GitHub 查看差异</button>}
    </div>
    <p className="px-2 py-1 text-[11px] text-[var(--text-muted)]">本地完整比较使用已获取的两侧提交；提交未在仓库中时请先获取对应分支。</p>
    {filesLoading ? <p role="status" className="p-3">读取差异中…</p> : filesError ? <p role="alert" className="p-3">{filesError}</p> : !file ? <p className="p-3">选择一个 PR 文件查看差异。</p> : <>
      <p className="break-all px-2 py-1">{file.newPath ?? file.oldPath}</p>
      {file.patchStatus === 'available' ? <div className="min-h-0 flex-1"><DiffHunkView fileDiff={{ ...file, binary: false }} /></div>
        : <p role="status" className="p-3">{file.patchStatus === 'unavailable' ? 'GitHub 未提供此文件的文本 patch；不能据此判断它是二进制文件。'
          : file.patchStatus === 'incomplete' ? 'GitHub 返回的 patch 不完整，已停止显示部分差异。'
            : '此文件 patch 超出当前显示预算，未截断为部分差异。'} 可使用上方完整正文比较。</p>}
    </>}
  </section>;
}
