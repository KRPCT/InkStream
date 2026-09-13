import { useEffect } from 'react';
import { useGitStore } from '../../stores/useGitStore';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { refreshGitAll } from '../../editor/gitActions';

/** 日常版本时间线复用仓库快照，复杂的分支、差异与远端操作仍交给版本管理。 */
export default function ProjectVersions() {
  const root = useGitStore((s) => s.repoRoot);
  const status = useGitStore((s) => s.status);
  const commits = useGitGraphStore((s) => s.commits);
  const graphRoot = useGitGraphStore((s) => s.repoRoot);
  const loading = useGitGraphStore((s) => s.loading);
  useEffect(() => { if (root) void refreshGitAll(root); }, [root]);
  const visible = graphRoot === root ? commits : [];
  return <section className="project-versions">
    <header><div><span className="workspace-caption">写作历程</span><h1>项目版本</h1></div>
      {root ? <button type="button" className="material-button" onClick={() => useWorkbenchStore.getState().setCentralView('gitGraph')}>打开版本管理</button> : null}
    </header>
    {!root ? <><p>项目还没有版本记录。</p><p>此目录尚未连接 Git 仓库。文稿仍可正常编辑和保存；在目录中建立仓库后，重新打开项目即可查看提交。</p></> : <>
      <p>{status?.branch ? `当前分支 · ${status.branch}` : '当前仓库'}{loading ? ' · 加载中…' : ''}</p>
      {!loading && visible.length === 0 ? <p>提交文稿后，可在这里回顾每一次修改。</p> : null}
      <ol className="version-timeline">{visible.map((commit) => <li key={commit.oid}>
        <button type="button" onClick={() => {
          useGitGraphStore.getState().setLeftMode('graph');
          useGitGraphStore.getState().selectCommit(commit.oid);
          useWorkbenchStore.getState().setCentralView('gitGraph');
        }}><time dateTime={new Date(commit.authorTime * 1000).toISOString()}>{new Date(commit.authorTime * 1000).toLocaleDateString()}</time><strong>{commit.summary}</strong><small>{commit.authorName} · {commit.oid.slice(0, 7)}</small></button>
      </li>)}</ol>
    </>}
  </section>;
}
