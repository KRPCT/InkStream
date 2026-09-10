import { indexRebuild } from '../../ipc/indexService';
import type { IndexScope } from '../../types/index';

export default function IndexQueryMessage({ error, disabled, scope }: {
  error: string | null;
  disabled: boolean;
  scope: IndexScope | null;
}) {
  return (
    <div role={error ? 'alert' : 'status'} className="p-3 text-[13px] text-[var(--text-muted)]">
      <p>{error ?? (disabled ? '打开工作区并启用关联功能后可查询。' : '正在读取关联信息…')}</p>
      {error && scope ? (
        <button type="button" className="mt-2 underline" onClick={() => void indexRebuild(scope.root).catch(() => {})}>
          重建索引并重试
        </button>
      ) : null}
    </div>
  );
}
