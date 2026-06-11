import { create } from 'zustand';

/** tab 元数据（可序列化；EditorState 实例不在此，缓存于 editor/editorState.ts）。 */
export interface TabMeta {
  /** 文件相对 vault 根路径（唯一键）。 */
  path: string;
  /** 显示名（文件名）。 */
  name: string;
}

interface EditorStoreState {
  /** 打开的 tab 列表（D-01 标签页模型）。 */
  tabs: TabMeta[];
  /** 活动 tab 的 path；无活动文件为 null。 */
  activePath: string | null;
  /** 每文件脏标记（未落盘防抖窗口，D-02）。 */
  dirty: Record<string, boolean>;
  /** 当前光标位置镜像（StatusBar 消费，单向自 CM updateListener 写入）。 */
  cursor: number;
  openTab: (tab: TabMeta) => void;
  closeTab: (path: string) => void;
  setActive: (path: string) => void;
  markDirty: (path: string) => void;
  clearDirty: (path: string) => void;
  setCursor: (pos: number) => void;
}

/**
 * tab 列表 / 活动 tab / 脏标记 / 光标镜像状态层。
 *
 * 真相源纪律：EditorView / EditorState 实例绝不进此 store（不可序列化纪律）。
 * doc 变化由 useCodeMirror 的 updateListener 单向镜像到 dirty/cursor，store 永不回写 CM。
 */
export const useEditorStore = create<EditorStoreState>((set) => ({
  tabs: [],
  activePath: null,
  dirty: {},
  cursor: 0,
  openTab: (tab) =>
    set((s) => (s.tabs.some((t) => t.path === tab.path) ? s : { tabs: [...s.tabs, tab] })),
  closeTab: (path) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.path !== path);
      const dirty = { ...s.dirty };
      delete dirty[path];
      // 关掉的是活动 tab：活动切到剩余首个 tab，无则 null
      const activePath = s.activePath === path ? (tabs[0]?.path ?? null) : s.activePath;
      return { tabs, dirty, activePath };
    }),
  setActive: (activePath) => set({ activePath }),
  markDirty: (path) => set((s) => ({ dirty: { ...s.dirty, [path]: true } })),
  clearDirty: (path) => set((s) => ({ dirty: { ...s.dirty, [path]: false } })),
  setCursor: (cursor) => set({ cursor }),
}));
