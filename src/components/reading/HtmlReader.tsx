import { useEffect, useRef, useState, type ReactNode } from 'react';
import { buildReadingFrame } from '../../editor/reading/buildReadingFrame';
import { detectGenre } from '../../editor/reading/detectGenre';
import { loadReadingHtml } from '../../editor/reading/loadContent';
import { readFraction, topVisibleIndex } from '../../editor/reading/readingPosition';
import { useBookshelfStore } from '../../stores/useBookshelfStore';
import { useReadingStore } from '../../stores/useReadingStore';
import type { ReadingDoc } from '../../types/reading';

/**
 * txt / docx / epub 阅读渲染（FEAT-READ）：解析为 HTML 放进 iframe 排版，据正文识别文体。
 * sandbox="allow-same-origin"（不含 allow-scripts）：内容脚本 / 事件 / javascript: 链接仍一律不执行
 * → 不可信文档跑不了代码、读不到 token（危险的是 same-origin + scripts 同时给，这里只给 same-origin）；
 * 仅借 same-origin 让父框测量与设置子文档滚动位，支撑「续读到上次行/段」。srcdoc 继承应用 CSP，资源加载仍受限。
 * 字号 / 主题 / 文体变化重建 srcdoc（iframe 重载），onLoad 再测量一次并恢复到当前续读锚点。
 */
const BLOCK_SEL =
  '.ink-reading p, .ink-reading h1, .ink-reading h2, .ink-reading h3, .ink-reading h4, .ink-reading h5, .ink-reading h6, .ink-reading li, .ink-reading blockquote, .ink-reading pre';
const SAVE_DEBOUNCE = 250;

export default function HtmlReader({ doc }: { doc: ReadingDoc }) {
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const genre = useReadingStore((s) => s.genre);
  const prefs = useReadingStore((s) => s.prefs);
  const setGenre = useReadingStore((s) => s.setGenre);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const detachRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let alive = true;
    setContent(null);
    setFailed(false);
    loadReadingHtml(doc.format as 'txt' | 'docx' | 'epub', doc.path)
      .then(({ html, text }) => {
        if (!alive) return;
        setContent(html);
        setGenre(detectGenre(text));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [doc.path, doc.format, setGenre]);

  // 切文档（doc.path 变）或卸载时摘除上一份滚动监听与待触发的去抖计时（onLoad 重建前也会先摘旧的）。
  useEffect(() => () => detachRef.current?.(), [doc.path]);

  // iframe 载入：测量各块内容顶端偏移 → 续读到上次锚点 → 挂去抖滚动监听记录进度（按 doc.path 键存）。
  const onFrameLoad = (): void => {
    detachRef.current?.();
    detachRef.current = null;
    const frame = frameRef.current;
    const win = frame?.contentWindow;
    const cdoc = frame?.contentDocument;
    const scroller = (cdoc?.scrollingElement ?? cdoc?.body) as HTMLElement | null;
    if (!win || !cdoc || !scroller) return; // 跨源被拦则静默退化为不续读
    const blocks = Array.from(cdoc.querySelectorAll<HTMLElement>(BLOCK_SEL));
    if (blocks.length === 0) return;
    // scrollTop=0 时，块的视口顶端偏移即其相对内容顶端的偏移。
    const tops = blocks.map((b) => b.getBoundingClientRect().top);

    const path = doc.path;
    const ctx = useReadingStore.getState().bookContext;
    const folder = !!ctx && ctx.chapters.length > 1; // 多章书：章内进度另记复合分数到 rootPath（与 PdfReader 对称）
    const saved = useBookshelfStore.getState().progress[path]?.index ?? 0;
    if (saved > 0 && saved < tops.length) scroller.scrollTop = tops[saved];

    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = (): void => {
      const idx = topVisibleIndex(tops, scroller.scrollTop);
      const store = useBookshelfStore.getState();
      // 文档内（章内）锚点始终记到 doc.path，支撑单文档与章内续读。
      store.setProgress(path, {
        fraction: readFraction(idx, blocks.length),
        index: idx,
        total: blocks.length,
        updatedAt: Date.now(),
      });
      if (folder && ctx) {
        const total = ctx.chapters.length;
        store.setProgress(ctx.rootPath, {
          fraction: (ctx.index + idx / blocks.length) / total,
          index: ctx.index,
          total,
          updatedAt: Date.now(),
        });
      }
    };
    const onScroll = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, SAVE_DEBOUNCE);
    };
    win.addEventListener('scroll', onScroll, { passive: true });
    detachRef.current = () => {
      if (timer) clearTimeout(timer);
      win.removeEventListener('scroll', onScroll);
    };
  };

  if (failed) return <Status>无法打开此文档，文件可能损坏或格式不受支持。</Status>;
  if (content === null) return <Status>正在加载…</Status>;
  return (
    <iframe
      ref={frameRef}
      title={doc.name}
      sandbox="allow-same-origin"
      onLoad={onFrameLoad}
      className="h-full w-full border-0"
      srcDoc={buildReadingFrame(content, genre, prefs)}
    />
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]">
      {children}
    </div>
  );
}
