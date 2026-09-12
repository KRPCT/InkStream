import { useEffect, useState } from 'react';
import type { GithubPage } from '../../types/githubPage';

/** One visible page per captured repository/filter; late refreshes cannot replace it. */
export function useGithubPage<T>(load: (page: number) => Promise<GithubPage<T>>) {
  const [pageNumber, setPageNumber] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ load: typeof load; page: number; data: GithubPage<T> } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void load(pageNumber).then((data) => {
      if (active) { setResult({ load, page: pageNumber, data }); setLoading(false); }
    }, (reason: unknown) => {
      if (active) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
    });
    return () => { active = false; };
  }, [load, pageNumber, revision]);
  const data = result?.load === load && result.page === pageNumber ? result.data : null;
  return { data, error, loading, pageNumber, setPageNumber,
    refresh: () => { setPageNumber(1); setRevision((value) => value + 1); } };
}
