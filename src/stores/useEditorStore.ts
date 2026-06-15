import { create } from 'zustand';
import type { RenderMode } from '../types/editor';

/** tab 元数据（可序列化；EditorState 实例不在此，缓存于 editor/editorState.ts）。 */
export interface TabMeta {
  /**
   * 唯一键：库内文件=相对 vault 根路径；库外（非工作区）文件=绝对路径；草稿=`draft://N`。
   * 三类 keyspace 互不撞键（相对路径无盘符/前导分隔，绝对路径必有，草稿有 `draft://` 前缀）。
   */
  path: string;
  /** 显示名（文件名）。 */
  name: string;
  /** 库外（非工作区）文件：path 为绝对路径，autosave 走绝对写、git 排除、tab 显「非工作区」标记。 */
  external?: boolean;
}

interface EditorStoreState {
  /** 打开的 tab 列表（D-01 标签页模型）。 */
  tabs: TabMeta[];
  /** 活动 tab 的 path；无活动文件为 null。 */
  activePath: string | null;
  /** 每文件脏标记（未落盘防抖窗口，D-02）。 */
  dirty: Record<string, boolean>;
  /** 每文件自动保存冻结标志（02-04 外部变更冲突期防误覆盖；本任务建开关）。 */
  frozen: Record<string, boolean>;
  /** 每文件外部变更冲突标志（D-04 脏文档冲突期，ExternalChangeBar 据此显隐）。 */
  externalChanged: Record<string, boolean>;
  /** 当前光标位置镜像（StatusBar 消费，单向自 CM updateListener 写入）。 */
  cursor: number;
  /** 活动文档是否为 richtext（frontmatter language: richtext）；richtext 工具条据此显隐（D-14）。 */
  isRichtext: boolean;
  /**
   * 活动文档当前渲染模式镜像（EDIT-02，单向自换装入口写入）。
   * markdown/richtext 文档为 'source' | 'live'；非 markdown 文档为 null（指示器隐藏，D-01）。
   * 权威 per-file 记忆在 editorState 的 renderModeCache（不可序列化态不进 store，T-03-10）。
   */
  activeRenderMode: RenderMode | null;
  openTab: (tab: TabMeta) => void;
  closeTab: (path: string) => void;
  /**
   * 切库重归位：把 tab 的 key 由 oldPath 迁到 newPath 并设 external 标记，
   * 同步迁移 dirty/frozen/externalChanged/activePath（保未落盘脏标记不丢、活动 tab 不变）。
   * 仅在 key 变化时调用（库内相对 ↔ 库外绝对）。
   */
  rehomeTab: (oldPath: string, newPath: string, external: boolean) => void;
  setActive: (path: string) => void;
  markDirty: (path: string) => void;
  clearDirty: (path: string) => void;
  freezeAutosave: (path: string) => void;
  unfreezeAutosave: (path: string) => void;
  markExternalChange: (path: string) => void;
  clearExternalChange: (path: string) => void;
  setCursor: (pos: number) => void;
  setRichtext: (on: boolean) => void;
  setActiveRenderMode: (mode: RenderMode | null) => void;
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
  frozen: {},
  externalChanged: {},
  cursor: 0,
  isRichtext: false,
  activeRenderMode: 'live',
  openTab: (tab) =>
    set((s) => (s.tabs.some((t) => t.path === tab.path) ? s : { tabs: [...s.tabs, tab] })),
  closeTab: (path) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.path !== path);
      const dirty = { ...s.dirty };
      delete dirty[path];
      const frozen = { ...s.frozen };
      delete frozen[path];
      const externalChanged = { ...s.externalChanged };
      delete externalChanged[path];
      // 关掉的是活动 tab：活动切到剩余首个 tab，无则 null
      const activePath = s.activePath === path ? (tabs[0]?.path ?? null) : s.activePath;
      return { tabs, dirty, frozen, externalChanged, activePath };
    }),
  rehomeTab: (oldPath, newPath, external) =>
    set((s) => {
      if (oldPath === newPath) return s;
      if (!s.tabs.some((t) => t.path === oldPath)) return s;
      const tabs = s.tabs.map((t) =>
        t.path === oldPath ? { ...t, path: newPath, external } : t,
      );
      // 迁移每文件布尔映射的键（保留旧值）。
      const move = (m: Record<string, boolean>): Record<string, boolean> => {
        if (!(oldPath in m)) return m;
        const next = { ...m };
        next[newPath] = next[oldPath];
        delete next[oldPath];
        return next;
      };
      return {
        tabs,
        dirty: move(s.dirty),
        frozen: move(s.frozen),
        externalChanged: move(s.externalChanged),
        activePath: s.activePath === oldPath ? newPath : s.activePath,
      };
    }),
  setActive: (activePath) => set({ activePath }),
  markDirty: (path) => set((s) => ({ dirty: { ...s.dirty, [path]: true } })),
  clearDirty: (path) => set((s) => ({ dirty: { ...s.dirty, [path]: false } })),
  freezeAutosave: (path) => set((s) => ({ frozen: { ...s.frozen, [path]: true } })),
  unfreezeAutosave: (path) => set((s) => ({ frozen: { ...s.frozen, [path]: false } })),
  markExternalChange: (path) =>
    set((s) => ({ externalChanged: { ...s.externalChanged, [path]: true } })),
  clearExternalChange: (path) =>
    set((s) => ({ externalChanged: { ...s.externalChanged, [path]: false } })),
  setCursor: (cursor) => set({ cursor }),
  setRichtext: (isRichtext) => set({ isRichtext }),
  setActiveRenderMode: (activeRenderMode) => set({ activeRenderMode }),
}));
