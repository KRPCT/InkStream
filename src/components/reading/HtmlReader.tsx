import { useEffect, useState, type ReactNode } from 'react';
import { buildReadingFrame } from '../../editor/reading/buildReadingFrame';
import { detectGenre } from '../../editor/reading/detectGenre';
import { loadReadingHtml } from '../../editor/reading/loadContent';
import { useReadingStore } from '../../stores/useReadingStore';
import type { ReadingDoc } from '../../types/reading';

/**
 * txt / docx / epub 阅读渲染（FEAT-READ）：解析为 HTML，放进无 allow-scripts 的 sandbox iframe 排版
 * （内容脚本 / 事件 / javascript: 链接一律不执行 → XSS 安全，无需逐节点 sanitize），并据正文识别文体。
 * 字号 / 主题 / 文体变化时重建 srcdoc（iframe 重载，会重置滚动位——可接受）。
 */
export default function HtmlReader({ doc }: { doc: ReadingDoc }) {
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const genre = useReadingStore((s) => s.genre);
  const prefs = useReadingStore((s) => s.prefs);
  const setGenre = useReadingStore((s) => s.setGenre);

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

  if (failed) return <Status>无法打开此文档，文件可能损坏或格式不受支持。</Status>;
  if (content === null) return <Status>正在加载…</Status>;
  return (
    // sandbox=""（最严）：脚本 / 表单 / 顶层导航 / same-origin 全禁，内容为 null 源——绝不能加 allow-same-origin
    // 配 allow-scripts（会令不可信文档取得 app 真源、读 token/localStorage）。静态 HTML + 内联 data: 图无需任何权限。
    <iframe
      title={doc.name}
      sandbox=""
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
