import { useState } from 'react';
import { BookMarked, CloudOff, RefreshCw } from 'lucide-react';
import { insertCitekey } from '../../editor/academicActions';
import { useReferenceLibrary } from '../../academic/useReferenceLibrary';
import { useEditorStore } from '../../stores/useEditorStore';
import { execute } from '../../commands/registry';

const text = (value: unknown): string => typeof value === 'string' ? value : '';

/** Sidebar 与文献工作区共用同一浏览契约，插入由当前文稿的命令边界接管。 */
export default function ZoteroLibraryPanel({ workspace = false, onInsert = insertCitekey }: {
  workspace?: boolean; onInsert?: (citekey: string) => void;
}) {
  const library = useReferenceLibrary();
  const [filter, setFilter] = useState('');
  const activePath = useEditorStore((s) => s.activePath);
  const { items, loading, error, offline, selected, detail, detailLoading, detailError } = library;
  const query = filter.trim().toLocaleLowerCase();
  const shown = items.filter((item) => [item.title, item.authors, item.year, item.citekey].some((value) => value.toLocaleLowerCase().includes(query)));
  return <section className={`reference-library${workspace ? ' reference-workspace' : ''}`} aria-label="Zotero 文献库">
    <header className="reference-library-heading">
      <BookMarked size={16} aria-hidden="true" /><span>Zotero 文献库</span>
      <span role="status">{error ? '未连接' : loading ? '加载中…' : items.length}</span>
      {offline && !error ? <CloudOff size={14} aria-label="离线缓存" /> : null}
      <button type="button" aria-label="刷新文献库" title="刷新文献库" disabled={loading} onClick={() => void library.load()}><RefreshCw size={15} /></button>
    </header>
    {error ? <div className="reference-empty" role="status"><p>{error}</p><p>连接 Zotero 与 Better BibTeX，或在设置中配置文献库。</p><button type="button" className="material-button" onClick={() => void execute('view.settings')}>打开设置</button></div> : <>
      <label className="reference-filter"><span className="sr-only">过滤文献</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="过滤文献…" /></label>
      <div className="reference-browser">
        <ul className="reference-list" aria-label="文献条目">
          {!loading && shown.length === 0 ? <li className="reference-empty">{items.length === 0 ? '库为空' : '无匹配'}</li> : null}
          {shown.map((item) => <li key={item.citekey}><button type="button" aria-pressed={selected?.citekey === item.citekey} onClick={() => void library.select(item)}>
            <span>{item.title || item.citekey}</span><small>{[item.authors, item.year].filter(Boolean).join(' · ') || item.citekey}</small>
          </button></li>)}
        </ul>
        <div className="reference-detail" aria-label="所选文献详情">
          {selected ? <>
            <div className="reference-detail-body">
            <h2>{selected.title || selected.citekey}</h2><p>{[selected.authors, selected.year].filter(Boolean).join(' · ')}</p>
            <dl><dt>引用键</dt><dd>{selected.citekey}</dd>
              {text(detail?.['container-title']) ? <><dt>出版物</dt><dd>{text(detail?.['container-title'])}</dd></> : null}
              {text(detail?.DOI) ? <><dt>DOI</dt><dd>{text(detail?.DOI)}</dd></> : null}
            </dl>
            {detailLoading ? <p role="status">加载详情…</p> : detailError ? <p role="status">详情暂不可用：{detailError}</p> : null}
            {text(detail?.abstract) ? <p className="reference-abstract">{text(detail?.abstract)}</p> : null}
            </div>
            <div className="reference-detail-action">
            <button type="button" className="reference-insert" disabled={!activePath} onClick={() => { const key = library.selectedKey(); if (key) onInsert(key); }}>插入所选引用</button>
            <small>{activePath ? '插入到当前文稿的光标位置' : '先打开或新建文稿，再插入引用'}</small>
            </div>
          </> : <p className="reference-empty">选择一篇文献查看详情</p>}
        </div>
      </div>
    </>}
  </section>;
}
