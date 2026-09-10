import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { retryTypstDocument } from '../../editor/livepreview/typst/typstDocument';
import { typstSvgElement } from '../../editor/livepreview/typst/typstSvg';
import { useTypstStore } from '../../stores/useTypstStore';
import EmptyState from '../common/EmptyState';
import { TAB_ICONS } from '../../modes/presets';

function CompiledFormula({ svg, ordinal }: { svg: string; ordinal: number }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = typstSvgElement(svg);
    mount.current?.replaceChildren(...(node ? [node] : [document.createTextNode('Typst 预览解析失败')]));
  }, [svg]);
  return <div ref={mount} role="img" aria-label={`Typst 公式 ${ordinal}`} className="overflow-x-auto bg-white p-3 text-black [&>svg]:h-auto [&>svg]:max-w-full" />;
}

export default function TypstPreviewPanel() {
  const { session, revision, phase, blocks } = useTypstStore();
  if (phase === 'paused') return <EmptyState icon={TAB_ICONS.typstPreview} heading="预览已暂停" body="基础编辑模式下暂停 Typst 编译。" />;
  if (blocks.length === 0 && phase === 'idle') return <EmptyState icon={TAB_ICONS.typstPreview} heading="暂无预览" body="文档包含 typst 块时，这里会显示编译结果。" />;
  return (
    <section data-testid="typst-preview-panel" data-document-session={session} data-revision={revision} className="h-full overflow-y-auto p-3">
      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span>{phase === 'loading' ? '正在加载编译器…' : phase === 'compiling' ? '编译中…' : phase === 'partial' ? '已生成部分预览' : `${blocks.length} 个 Typst 块`}</span>
        <button type="button" onClick={retryTypstDocument} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--background-modifier-hover)]" aria-label="重新编译 Typst">
          <RefreshCw size={12} aria-hidden="true" />重新编译
        </button>
      </div>
      <div className="space-y-4">
        {blocks.map((block, index) => (
          <figure key={`${session}:${block.from}`} className="overflow-hidden rounded border border-[var(--background-modifier-border)]">
            <figcaption className="border-b border-[var(--background-modifier-border)] px-3 py-1.5 text-xs text-[var(--text-muted)]">{block.equationNumber ? `公式（${block.equationNumber}）` : `Typst 块 ${index + 1}`}</figcaption>
            {block.status === 'ready' && block.svg ? <CompiledFormula svg={block.svg} ordinal={block.equationNumber ?? index + 1} />
              : block.status === 'error' ? <p role="alert" className="whitespace-pre-wrap break-words p-3 text-xs text-[var(--color-error)]">{block.error}</p>
                : <p className="p-3 text-xs text-[var(--text-muted)]">{block.status === 'empty' ? '空白 Typst 块' : block.status === 'loading' ? '加载中…' : '编译中…'}</p>}
          </figure>
        ))}
      </div>
    </section>
  );
}
