import { EditorState, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { readFile } from '../ipc/files';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { baseExtensions } from './extensions';
import { readLanguage } from './frontmatter';
import { languageFromDoc, markAppliedLanguage } from './languages';
import { getView } from './viewHandle';
import { getRenderMode, isMarkdownDoc, setRenderMode } from './livepreview/renderMode';
import type { RenderMode } from '../types/editor';

/**
 * 每文件 EditorState 缓存（D-03 会话内）。
 *
 * 模块级单例 Map（同 commands/registry.ts 单例纪律）——不可序列化的 EditorState 实例
 * 绝不进 Zustand，只在此模块内按 path 键缓存。关 tab 即 disposeState 释放。
 *
 * 真相源纪律：切换文件用 view.setState(整体换装)，绝不用 transaction/reconfigure 换文档
 * （Pitfall 3：避免 undo 历史跨文件串味）。每文件独立 EditorState 各持独立 history。
 */

const cache = new Map<string, EditorState>();

/**
 * 每文件滚动位置缓存（D-03 滚动位置显式恢复）。
 *
 * 滚动是 CM6 view 级关注点——view.setState 还原 doc/光标/选区/undo，但**不**携带 view 级
 * 滚动状态。故独立 Map 缓存 scrollTop，切走时记录、切回时在 setState 后回填（D-03 原文列项）。
 */
const scrollCache = new Map<string, number>();

/**
 * 每文件渲染模式记忆（D-03 会话内，EDIT-02）。
 *
 * 平行 scrollCache：renderMode 是 view 级关注点（compartment 装的扩展），view.setState 换装
 * 不携带它。故按 path 缓存当前文件的 source/live 选择，切走时记录、切回时 setRenderMode 重放，
 * 关 tab 即释放、不跨重启持久化。store.activeRenderMode 仅镜像当前活动文件（权威在此 Map）。
 */
const renderModeCache = new Map<string, RenderMode>();

/** 取某 path 的会话内 renderMode 记忆（无记忆返回 null；测试/调用方据此判初次打开）。 */
export function getRenderModeForPath(path: string): RenderMode | null {
  return renderModeCache.get(path) ?? null;
}

/**
 * 把当前 view 的 renderMode 态镜像到 store（仿 syncRichtext 单向纪律，D-01 显隐）。
 *
 * markdown/richtext 文档：镜像当前 compartment 模式（source/live）；
 * 非 markdown 文档：镜像置 null——指示器隐藏、toggle 命令 no-op（D-01 同条件）。
 */
function syncRenderMode(view: EditorView, path: string): void {
  const md = isMarkdownDoc(view.state.doc.toString(), path);
  useEditorStore.getState().setActiveRenderMode(md ? getRenderMode(view) : null);
}

/**
 * 打开/切到文件时应用其会话内 renderMode 记忆并同步镜像。
 *
 * 仅 markdown/richtext 文档应用：无记忆默认 'live'（D-02）；非 markdown 文档跳过 setRenderMode
 * （其 compartment 本就空），镜像由 syncRenderMode 置 null。
 */
function applyRenderMode(view: EditorView, path: string): void {
  if (isMarkdownDoc(view.state.doc.toString(), path)) {
    setRenderMode(view, renderModeCache.get(path) ?? 'live');
  }
  syncRenderMode(view, path);
}

/** 在 setState 之后推迟一帧回填滚动位置：避免被 setState 触发的布局重排覆盖。 */
function restoreScroll(view: EditorView, top: number): void {
  requestAnimationFrame(() => {
    view.scrollDOM.scrollTop = top;
  });
}

/**
 * 把当前 view 的 richtext 态镜像到 store（D-14 工具条显隐）。
 *
 * 单向：CM doc 头部 frontmatter language === 'richtext' → store.isRichtext。
 * view.setState 换装不触发 updateListener，故切换文件由换装入口（openFile/switchToTab）
 * 显式调用；docChanged 路径由 useCodeMirror 的 updateListener 调用。store 永不回写 CM。
 */
export function syncRichtext(view: EditorView): void {
  const isRichtext = readLanguage(view.state.doc.toString()) === 'richtext';
  if (useEditorStore.getState().isRichtext !== isRichtext) {
    useEditorStore.getState().setRichtext(isRichtext);
  }
}

/**
 * 打开文件：命中缓存则恢复其完整 state（含光标/选区/undo 历史）；
 * 未命中则用 doc + ext 新建 EditorState 后整体换装。
 *
 * 换装后回填该 path 的滚动位置（缓存有则还原，无则置 0），实现 D-03 滚动位置恢复。
 */
export function openFile(view: EditorView, path: string, doc: string, ext: Extension): void {
  const cached = cache.get(path);
  const state = cached ?? EditorState.create({ doc, extensions: ext });
  view.setState(state);
  restoreScroll(view, scrollCache.get(path) ?? 0);
  syncRichtext(view);
  applyRenderMode(view, path);
  // 焦点纪律：不程序化抢焦点。WebView2 只在「真实指针进入编辑器」时武装 OS IME/TSF，
  // 任何 programmatic 聚焦（view.focus / MoveFocus / EditContext）都不武装中文输入（真机 CDP 证）；
  // auto-focus 给的假光标反而诱导首次中文组合丢字。故由用户点击编辑器自然落焦（见 CONSTRAINTS §8）。
}

/**
 * 从磁盘重载某文件（D-04 外部变更：干净静默重载 / 「重载丢弃我的修改」）。
 *
 * 丢弃该 path 的缓存 state（含未落盘编辑与 undo 历史）后按磁盘内容重建并整体换装。
 * 仅当该 path 为当前活动文件时换装（否则只清缓存，下次打开自然读最新盘）。
 * 无 vault / 无 view 静默返回。读盘失败抛出由调用方兜底（仲裁层吞并提示）。
 */
export async function reloadFromDisk(path: string): Promise<void> {
  const vault = useVaultStore.getState().vault;
  const view = getView();
  cache.delete(path);
  scrollCache.delete(path);
  if (!vault || !view) return;
  const doc = await readFile(vault.root, path);
  if (useEditorStore.getState().activePath !== path) return;
  const lang = languageFromDoc(doc, path);
  openFile(view, path, doc, baseExtensions(lang));
  markAppliedLanguage(view, lang);
}

/**
 * 切到已打开（缓存命中）的 tab：快照当前活动文件 → setState 还原目标 + setActive + 滚动还原。
 *
 * 单内核换装的统一入口（EditorTabs 点击调用，组件不重复实现滚动/快照逻辑）。view 经 getView()
 * 解析。与 openFile 区别：不重读磁盘 doc——已开文件的最新编辑就在缓存 state 里。缓存缺失（异常）
 * 时仍 setActive，由 EditorArea 的打开流程兜底；无 view（未挂载）时静默返回。
 */
export function switchToTab(path: string): void {
  const view = getView();
  if (!view) return;
  const active = useEditorStore.getState().activePath;
  if (active && active !== path) snapshotBeforeSwitch(view, active);
  const cached = cache.get(path);
  if (cached) {
    view.setState(cached);
    restoreScroll(view, scrollCache.get(path) ?? 0);
    syncRichtext(view);
    applyRenderMode(view, path);
  }
  useEditorStore.getState().setActive(path);
}

/** 切走当前文件前，把 view.state 快照与当前 scrollTop 存入缓存（含光标/选区/undo + 滚动位置）。 */
export function snapshotBeforeSwitch(view: EditorView, path: string): void {
  cache.set(path, view.state);
  scrollCache.set(path, view.scrollDOM.scrollTop);
  // 仅 markdown/richtext 文档记 renderMode（非 md 文档无切换语义，不污染缓存）。
  if (isMarkdownDoc(view.state.doc.toString(), path)) {
    renderModeCache.set(path, getRenderMode(view));
  }
}

/**
 * 取某 path 的文档真相源内容（CR-01 跨文件覆盖修复）。
 *
 * 单内核架构下活动文件的最新编辑只在 live view，未必已快照入缓存；非活动文件的最新编辑
 * 在切走时已 snapshotBeforeSwitch 入缓存。故：活动路径读 live view，其余路径读缓存 state。
 * 缓存/view 均缺失时返回 null（调用方落盘前据此跳过，绝不拿错文件内容覆盖）。
 *
 * 不导出原始 cache Map（封装纪律）——只提供按 path 的只读取值口。
 */
export function getDocForPath(path: string): string | null {
  if (useEditorStore.getState().activePath === path) {
    const view = getView();
    if (view) return view.state.doc.toString();
  }
  const cached = cache.get(path);
  return cached ? cached.doc.toString() : null;
}

/** 关 tab 时释放该文件 state 与滚动缓存（D-03 会话内，关 tab 即释放）。 */
export function disposeState(path: string): void {
  cache.delete(path);
  scrollCache.delete(path);
  renderModeCache.delete(path);
}

/** 仅供测试：清空缓存以隔离用例。 */
export function __clearCacheForTest(): void {
  cache.clear();
  scrollCache.clear();
  renderModeCache.clear();
}
