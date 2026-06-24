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
 * 字号 / 主题 / 文体变化重建 srcdoc（iframe 重载），onLoad 再测量一次并恢复到当前续读锚点；
 * 内嵌 base64(data:) 图解码后块偏移会变，故图就绪后重测并（用户未滚动时）再次定位，修图多文档落点漂移。
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
    const path = doc.path;
    const ctx = useReadingStore.getState().bookContext;
    const folder = !!ctx && ctx.chapters.length > 1; // 多章书：章内进度另记复合分数到 rootPath（与 PdfReader 对称）
    const saved = useBookshelfStore.getState().progress[path]?.index ?? 0;

    // scrollTop=0 时块的视口顶端偏移即相对内容顶端的偏移。base64(data:) 图未解码完会让此值偏小，故图就绪后再校准。
    let tops = blocks.map((b) => b.getBoundingClientRect().top);
    let userScrolled = false;
    let programmatic = false;
    const restore = (): void => {
      if (saved <= 0 || saved >= tops.length) return;
      programmatic = true; // 本次程序化滚动产生的 scroll 事件不计作用户操作
      scroller.scrollTop = tops[saved];
      requestAnimationFrame(() => {
        programmatic = false;
      });
    };
    restore();

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
      if (!programmatic) userScrolled = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, SAVE_DEBOUNCE);
    };
    win.addEventListener('scroll', onScroll, { passive: true });

    // 内嵌 base64(data:) 图（docx/epub）：iframe load 多已等到图 complete（实测同步测量即含图高、无漂移），
    // 但个别引擎 / 超大图可能在 onLoad 同步测量之后才完成解码与布局致块偏移变化。用 img.decode() 等全部图
    // 解码就绪后重测各块偏移；用户未手动滚动则重新定位到续读块——有漂移则修正，无漂移则无副作用。
    const imgs = Array.from(cdoc.images);
    let recalTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const recalibrate = (): void => {
      if (cancelled) return;
      tops = blocks.map((b) => b.getBoundingClientRect().top);
      if (!userScrolled) restore();
    };
    if (imgs.length > 0) {
      void Promise.allSettled(imgs.map((im) => im.decode().catch(() => undefined))).then(() => {
        if (recalTimer) clearTimeout(recalTimer);
        recalibrate();
      });
      recalTimer = setTimeout(recalibrate, 1500); // 兜底：decode 迟迟不结束也校准一次
    }

    detachRef.current = () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (recalTimer) clearTimeout(recalTimer);
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
