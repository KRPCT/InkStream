import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { detectGenre } from '../../editor/reading/detectGenre';
import { READING_THEMES } from '../../editor/reading/readingPresets';
import { readFileBytes } from '../../ipc/files';
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

      for (let n = 1; n <= pdf.numPages; n += 1) {
        const slot = document.createElement('div');
        slot.dataset.page = String(n);
        slot.style.width = `${base.width}px`;
        slot.style.height = `${base.height}px`;
        slot.className = 'mx-auto my-3 max-w-full [box-shadow:var(--shadow-popup)]';
        host.appendChild(slot);
        observer.observe(slot);
      }
      if (alive) setStatus('ready');
    })().catch(() => {
      if (alive) setStatus('error');
    });

    return () => {
      alive = false;
      observer?.disconnect();
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
