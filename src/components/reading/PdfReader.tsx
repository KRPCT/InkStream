import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { detectGenre } from '../../editor/reading/detectGenre';
import { READING_THEMES } from '../../editor/reading/readingPresets';
import { readFileBytes } from '../../ipc/files';
import { useBookshelfStore } from '../../stores/useBookshelfStore';
import { useReadingStore } from '../../stores/useReadingStore';
import type { ReadingDoc } from '../../types/reading';

const SCALE = 1.5;

/**
 * PDF 阅读（FEAT-READ）：pdfjs-dist 4.10.38（decoder 纯 JS，无运行时 wasm fetch——避 v5/v6 的 wasm/CSP 面）。
 * 逐页占位 + IntersectionObserver 懒渲染：仅画视口附近页，远离即释放 canvas backing store——大 PDF 不会一次画
 * 全部页 OOM。抽前 3 页文本识别文体。canvas 由 ref 容器命令式管理；卸载销毁 loadingTask（含未 resolve 的 worker，
 * 修 StrictMode 双挂载泄漏）。
 */
export default function PdfReader({ doc }: { doc: ReadingDoc }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const theme = useReadingStore((s) => s.prefs.theme);
  const setGenre = useReadingStore((s) => s.setGenre);

  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | null = null;
    let observer: IntersectionObserver | null = null;
    let reportObs: IntersectionObserver | null = null;
    const canvases = new Map<number, HTMLCanvasElement>();
    setStatus('loading');

    void (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = (
        await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ).default;
      const bytes = await readFileBytes(doc.path);
      task = pdfjs.getDocument({ data: bytes });
      const pdf: PDFDocumentProxy = await task.promise;
      const host = hostRef.current;
      if (!alive || !host) return;
      host.replaceChildren();

      // 文体识别：前 3 页文本。
      let sample = '';
      for (let n = 1; n <= Math.min(3, pdf.numPages); n += 1) {
        const tc = await (await pdf.getPage(n)).getTextContent();
        sample += `${tc.items.map((it) => ('str' in it ? it.str : '')).join(' ')}\n`;
      }
      if (!alive) return;
      setGenre(detectGenre(sample));
      const base = (await pdf.getPage(1)).getViewport({ scale: SCALE }); // 占位尺寸（多数 PDF 同尺寸）

      const renderSlot = async (slot: HTMLElement, n: number): Promise<void> => {
        if (canvases.has(n)) return;
        const page = await pdf.getPage(n);
        if (!alive) return;
        const viewport = page.getViewport({ scale: SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = 'block h-full w-full';
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        slot.replaceChildren(canvas);
        canvases.set(n, canvas);
        await page.render({ canvasContext: ctx, viewport }).promise;
      };
      const freeSlot = (slot: HTMLElement, n: number): void => {
        const c = canvases.get(n);
        if (!c) return;
        c.width = 0; // 释放 backing store
        c.height = 0;
        canvases.delete(n);
        slot.replaceChildren();
      };

      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const slot = e.target as HTMLElement;
            const n = Number(slot.dataset.page);
            if (e.isIntersecting) void renderSlot(slot, n);
            else freeSlot(slot, n);
          }
        },
        { root: scrollRef.current, rootMargin: '150% 0px' },
      );

      // 阅读进度：真正进入视口的最靠前页 → setProgress（书架进度提示；与渲染观察器分开，rootMargin 0 取实际视口页）。
      // 书架书（bookContext 在架）：进度记到书的 rootPath，分数 = 章位置 + 章内页贡献，故文件夹书的页进度不被孤立。
      const ctx = useReadingStore.getState().bookContext;
      // 单文档 / 单文件书（章数 ≤ 1）→ 页级续读记到 doc.path；多章书 → 复合分数记到书 rootPath（章级续读由 openBook 处理）。
      const standalone = !ctx || ctx.chapters.length <= 1;
      const visible = new Set<number>();
      reportObs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) visible.add(n);
            else visible.delete(n);
          }
          if (visible.size === 0) return;
          const page = Math.min(...visible);
          const intra = (page - 1) / pdf.numPages;
          const store = useBookshelfStore.getState();
          // 文档内（章内）页锚点始终记到 doc.path，支撑单文档与章内续读。
          store.setProgress(doc.path, {
            fraction: page / pdf.numPages,
            index: page - 1,
            total: pdf.numPages,
            updatedAt: Date.now(),
          });
          // 多章书：另记复合分数到书 rootPath（驱动画廊进度条，与章级续读同键）。
          if (!standalone && ctx) {
            const total = ctx.chapters.length;
            store.setProgress(ctx.rootPath, {
              fraction: (ctx.index + intra) / total,
              index: ctx.index,
              total,
              updatedAt: Date.now(),
            });
          }
        },
        { root: scrollRef.current, rootMargin: '0px', threshold: 0.1 },
      );

      for (let n = 1; n <= pdf.numPages; n += 1) {
        const slot = document.createElement('div');
        slot.dataset.page = String(n);
        slot.style.width = `${base.width}px`;
        slot.style.height = `${base.height}px`;
        slot.className = 'mx-auto my-3 max-w-full [box-shadow:var(--shadow-popup)]';
        host.appendChild(slot);
        observer.observe(slot);
        reportObs.observe(slot);
      }
      // 续读：恢复到上次所在页（单文档 / 单文件书 / 多章书的章内页，统一按 doc.path；占位 slot 尺寸已定，offset 稳定）。
      if (alive && scrollRef.current) {
        const savedIdx = useBookshelfStore.getState().progress[doc.path]?.index ?? 0;
        if (savedIdx > 0 && savedIdx < pdf.numPages) {
          const slot = host.children[savedIdx] as HTMLElement | undefined;
          if (slot) {
            scrollRef.current.scrollTop +=
              slot.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top;
          }
        }
      }
      if (alive) setStatus('ready');
    })().catch(() => {
      if (alive) setStatus('error');
    });

    return () => {
      alive = false;
      observer?.disconnect();
      reportObs?.disconnect();
      canvases.forEach((c) => {
        c.width = 0;
        c.height = 0;
      });
      canvases.clear();
      void task?.destroy(); // 销毁 loadingTask + document + worker（含未 resolve 情形）
    };
  }, [doc.path, setGenre]);

  return (
    <div ref={scrollRef} className="h-full overflow-auto p-2" style={{ backgroundColor: READING_THEMES[theme].bg }}>
      <div ref={hostRef} />
      {status !== 'ready' ? (
        <div className="flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]">
          {status === 'loading' ? '正在打开 PDF…' : '无法打开此 PDF。'}
        </div>
      ) : null}
    </div>
  );
}
