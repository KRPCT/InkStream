import { useCallback, useEffect, useRef, useState } from 'react';
import { currentZoteroLibraryRevision, onZoteroLibraryChanged, zoteroCslResilient, zoteroItemsResilient } from '../ipc/zotero';
import type { CslItem, ZoteroItem } from '../types/zotero';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** 文献浏览会话。库身份、列表与所选详情作为同一生命周期失效；选择不写入文档。 */
export function useReferenceLibrary() {
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<ZoteroItem | null>(null);
  const [detail, setDetail] = useState<CslItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const libraryRevision = useRef(currentZoteroLibraryRevision());
  const clearSelection = useCallback(() => {
    detailRequest.current += 1;
    setSelected(null); setDetail(null); setDetailError(null); setDetailLoading(false);
  }, []);
  const load = useCallback(async () => {
    const request = ++listRequest.current;
    const revision = currentZoteroLibraryRevision();
    libraryRevision.current = revision;
    clearSelection(); setItems([]); setLoading(true); setError(null); setOffline(false);
    const current = () => request === listRequest.current && revision === currentZoteroLibraryRevision();
    try {
      const result = await zoteroItemsResilient();
      if (current()) { setItems(result.items); setOffline(result.offline); }
    } catch (failure) { if (current()) setError(message(failure)); }
    finally { if (current()) setLoading(false); }
  }, [clearSelection]);
  useEffect(() => {
    const unsubscribe = onZoteroLibraryChanged(() => { void load(); });
    void load();
    return () => { listRequest.current += 1; detailRequest.current += 1; unsubscribe(); };
  }, [load]);

  const select = async (item: ZoteroItem) => {
    if (libraryRevision.current !== currentZoteroLibraryRevision() || !items.includes(item)) return;
    const request = ++detailRequest.current;
    const revision = libraryRevision.current;
    setSelected(item); setDetail(null); setDetailError(null); setDetailLoading(true);
    const current = () => request === detailRequest.current && revision === currentZoteroLibraryRevision();
    try {
      const result = await zoteroCslResilient([item.citekey]);
      if (current()) setDetail(result.find((entry) =>
        String(entry.id) === item.citekey || entry['citation-key'] === item.citekey || entry.citekey === item.citekey) ?? null);
    } catch (failure) { if (current()) setDetailError(message(failure)); }
    finally { if (current()) setDetailLoading(false); }
  };
  const selectedKey = () => libraryRevision.current === currentZoteroLibraryRevision() ? selected?.citekey ?? null : null;
  return { items, loading, error, offline, selected, detail, detailLoading, detailError, load, select, selectedKey };
}
