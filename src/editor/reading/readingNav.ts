/**
 * 阅读器命令桥（FEAT-READ 阅读器增强）：解耦 TOC/书签 UI（ReadingView）与 iframe 滚动器（HtmlReader）。
 *
 * HtmlReader 在 iframe 载入后注册 nav（闭包持 scroller / tops / blocks）；切文档或卸载时置 null。
 * 不把不可序列化的 iframe 引用塞进 zustand（store 纯净纪律），改走此模块级单例——TOC 点击与书签捕获/跳转
 * 皆经此桥，PDF（无 HTML 阅读器）时 nav 为 null，调用静默空操作，上层据 readingPosition() 判可用性。
 */
export interface ReadingNav {
  /** 滚到第 index 个内容块（TOC / 书签跳转）。 */
  scrollToBlock: (index: number) => void;
  /** 当前视口顶端所在块下标（书签捕获）。 */
  currentBlock: () => number;
  /** 内容块总数。 */
  totalBlocks: () => number;
  /** 第 index 块的短标签（书签自动命名用）。 */
  blockLabel: (index: number) => string;
}

let nav: ReadingNav | null = null;

export function setReadingNav(n: ReadingNav | null): void {
  nav = n;
}

export function readingScrollTo(index: number): void {
  nav?.scrollToBlock(index);
}

/** 当前阅读位置（无活动 HTML 阅读器时返回 null，如 PDF / 尚未载入）。 */
export function readingPosition(): { index: number; total: number; label: string } | null {
  if (!nav) return null;
  const index = nav.currentBlock();
  return { index, total: nav.totalBlocks(), label: nav.blockLabel(index) };
}
