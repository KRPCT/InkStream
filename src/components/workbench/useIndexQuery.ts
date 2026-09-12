import { useEffect, useState } from 'react';
import { useIndexStore } from '../../stores/useIndexStore';

/** 查询结果绑定scope与提交revision；同名文件切库、旧Promise及已失效结果都不可回填。 */
export function useIndexQuery<T>(load: (signal: AbortSignal) => Promise<T>, enabled = true, reload = 0) {
  const scope = useIndexStore((s) => s.scope);
  const revision = useIndexStore((s) => s.revision);
  const status = useIndexStore((s) => s.status);
  const indexError = useIndexStore((s) => s.error);
  const key = `${scope?.sessionId ?? 'disabled'}:${revision}:${reload}`;
  const [result, setResult] = useState<{ key: string; load: ((signal: AbortSignal) => Promise<T>) | null; data: T | null; error: string | null }>({
    key: '', load: null, data: null, error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const controller = new AbortController();
    const isCurrent = (): boolean => {
      const current = useIndexStore.getState();
      return alive && current.scope?.sessionId === scope?.sessionId && current.revision === revision;
    };
    void load(controller.signal).then(
      (data) => { if (isCurrent()) setResult({ key, load, data, error: null }); },
      (error: unknown) => {
        if (isCurrent()) setResult({ key, load, data: null, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => { alive = false; controller.abort(); };
  }, [load, key, enabled, scope?.sessionId, revision]);

  const current = result.key === key && result.load === load;
  const error = enabled && status !== 'preparing' ? indexError ?? (current ? result.error : null) : null;
  return {
    scope,
    data: enabled && current ? result.data : null,
    error,
    disabled: status === 'disabled',
    loading: enabled && status !== 'disabled' && !error &&
      (status === 'preparing' || !current || result.data === null),
  };
}
