import { create } from 'zustand';
import type { OutlineItem } from '../types/editor';

/**
 * 活动文档大纲镜像（RightPanel 大纲 tab）。
 *
 * 单向纪律：CM 语法树 → store（editor/outline.ts 的 syncOutline 在换装入口 + docChanged 时写入），
 * store 永不回写 CM。与 useEditorStore 的 isRichtext/activeRenderMode 同为 view 级镜像，但析出独立 store
 * 隔离逐键击的大纲变更，不惊动其它 editor-store 订阅方。
 */
interface OutlineState {
  items: OutlineItem[];
  setOutline: (items: OutlineItem[]) => void;
}

export const useOutlineStore = create<OutlineState>((set) => ({
  items: [],
  setOutline: (items) => set({ items }),
}));
