import { Compartment, EditorState, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { readFile } from '../ipc/files';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { isComposing, queueAfterComposition, refreshLivePreview } from './composition';
import { baseExtensions } from './extensions';
import { readLanguage } from './frontmatter';
import { languageFromDoc, markAppliedLanguage } from './languages';
import { syncCitations } from './citations';
import { getView, scrollContainer } from './viewHandle';
import { syncOutline } from './outline';
import { syncSceneSummary } from './sceneSummary';
import { rebaseWordCount } from './wordCount';
import { imageVaultFacet } from './livepreview/inlinePlugin';
import { basename, isAbsolutePath, parentDir } from './pathUtil';
import {
  applyRenderMode,
  clearRenderModeCache,
  disposeRenderMode,
  rekeyRenderMode,
  snapshotRenderMode,
} from './editorState.renderMode';

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

/** per-file renderMode 记忆下沉 editorState.renderMode；此处 re-export 取值口（消费方/测试单一入口）。 */
export { getRenderModeForPath } from './editorState.renderMode';

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

/** #17 真实滚动容器选择已下沉 viewHandle（视图级 DOM 工具，免 editorState↔outline 环）；此处再导出保消费方/测试单一入口。 */
export { scrollContainer } from './viewHandle';

/** 在 setState 之后推迟一帧回填滚动位置：避免被 setState 触发的布局重排覆盖。 */
function restoreScroll(view: EditorView, top: number): void {
  requestAnimationFrame(() => {
    scrollContainer(view).scrollTop = top;
  });
}

/**
 * 统一换装门（根治「换汤不换药」，§4.1）：组合期把整段换装推迟到 compositionend drain。
 *
 * setState 零组合感知，组合期换装撕掉 IME 锚定的 DocView 必吞字（铁律 2）。openFile/switchToTab/
 * reloadFromDisk 的换装体（setState+restoreScroll+syncRichtext+applyRenderMode）整体进 doSwap，
 * 组合期按 'swap:'+key 去重排队（先切 A 后切 B 排两个 task 按入队序停 B；都切 A 去重一次）。
 * 用户点 tab 触发的 openFile/switchToTab 至此也过门，不再裸奔。
 */
function swapState(view: EditorView, key: string, doSwap: () => void): void {
  if (isComposing(view)) {
    queueAfterComposition(view, 'swap:' + key, doSwap);
    return;
  }
  doSwap();
}

/**
 * 图片解析上下文：库外文件（绝对 path）按其所在目录解析相对图片；
 * 库内文件按当前 vault 根 + 相对 path 解析。无 vault 且非绝对（不该发生）→ null。
 *
 * 编辑器 live preview 与文件导出（imageEmbed）共用此唯一推导口——保证导出内嵌的图与编辑器所见一致。
 */
export function imageContextForPath(path: string): { root: string; docPath: string } | null {
  if (isAbsolutePath(path)) return { root: parentDir(path), docPath: basename(path) };
  const root = useVaultStore.getState().vault?.root ?? null;
  return root ? { root, docPath: path } : null;
}

/**
 * 图片 vault 上下文经 Compartment 注入（而非直接 facet.of）：使切库重归位（rehome）后能按新 key
 * 重导上下文——否则 re-key 的 EditorState 仍持旧 facet，相对图片按旧库根解析（甚至误判越界 vault 根）。
 */
const imageVaultCompartment = new Compartment();

/**
 * 重建某 path 的图片上下文（rehome 后调，按新 key 重导）：
 * - 活动 tab：reconfigure 活动 view 的 compartment + refreshLivePreview 强刷一次（装饰立即按新库根解析图片），同步缓存；
 * - 非活动 tab：只更其缓存 state 的 facet——切回该 tab 时 setState 重挂插件即按新 facet 构建装饰。
 */
export function reapplyImageContext(path: string): void {
  const facet = imageVaultFacet.of(imageContextForPath(path));
  const view = getView();
  if (view && useEditorStore.getState().activePath === path) {
    view.dispatch({
      effects: [imageVaultCompartment.reconfigure(facet), refreshLivePreview.of(null)],
    });
    cache.set(path, view.state);
    return;
  }
  const st = cache.get(path);
  if (st !== undefined) {
    cache.set(path, st.update({ effects: imageVaultCompartment.reconfigure(facet) }).state);
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
  // 图片 vault 上下文经 per-view facet 注入（WR-07）：装饰构建不读全局 store，绑定各自 EditorState；
  // 换装入口是 store 读取合法位（同 applyRenderMode/syncRichtext），root+docPath 一次取写入门生命周期恒定。
  const vaultFacet = imageVaultCompartment.of(imageVaultFacet.of(imageContextForPath(path)));
  const state = cached ?? EditorState.create({ doc, extensions: [ext, vaultFacet] });
  swapState(view, path, () => {
    view.setState(state);
    restoreScroll(view, scrollCache.get(path) ?? 0);
    syncRichtext(view);
    applyRenderMode(view, path);
    // IN-06：换装后把语言 diff 基线对齐到新文件的实际语言——否则 lastAppliedLanguage 仍是上一文件的，
    // 下一次 docChanged 会按错基线多切一次 reconfigure（或漏切）。
    markAppliedLanguage(view, languageFromDoc(state.doc.toString(), path));
    // 大纲镜像（RightPanel 大纲 tab）：换装不触发 updateListener，故同 syncRichtext 在此显式同步。
    syncOutline(view);
    // 光标镜像（#2b）：setState 换装不触发 updateListener，须在此把恢复后的选区头同步给 store，
    // 否则面包屑 / 大纲活动项 / 状态栏行列沿用上一文件的光标偏移，直到用户在新文件里首次落选。
    useEditorStore.getState().setCursor(view.state.selection.main.head);
    syncCitations(view); // 引用镜像（ZOT-03）同此显式同步
    rebaseWordCount(view); // 字数基线（CREA-04）：换装不触发 updateListener，此处重设基线、不计入今日写入
    syncSceneSummary(view); // 场景概要镜像（CREA-05），同 syncOutline 在换装入口补位
  });
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
 * 解析。与 openFile 区别：不重读磁盘 doc——已开文件的最新编辑就在缓存 state 里。
 *
 * IN-05：缓存缺失时绝不翻 activePath——否则 view 仍显旧文档、activePath 已指新 path，二者失同步
 * （下游 getDocForPath/autosave 据 activePath 取真相源会拿错 view 内容）。已打开的 tab 必有缓存，
 * 缺失即异常，此时静默不切（保持当前文件），数据安全优先。无 view（未挂载）时静默返回。
 */
export function switchToTab(path: string): void {
  const view = getView();
  if (!view) return;
  const cached = cache.get(path);
  if (!cached) return; // 缓存缺失：不换装、不翻 activePath，保 view/activePath 同步（IN-05）。
  const active = useEditorStore.getState().activePath;
  // snapshotBeforeSwitch 纯读 view.state（不撕 DOM、不 dispatch），门外同步跑——保证快照已存、数据零丢失。
  if (active && active !== path) snapshotBeforeSwitch(view, active);
  swapState(view, path, () => {
    view.setState(cached);
    restoreScroll(view, scrollCache.get(path) ?? 0);
    syncRichtext(view);
    applyRenderMode(view, path);
    // IN-06：换装后对齐语言 diff 基线到目标文件实际语言（同 openFile，防多余/漏 reconfigure）。
    markAppliedLanguage(view, languageFromDoc(cached.doc.toString(), path));
    syncOutline(view);
    // 光标镜像（#2b）：缓存态恢复的选区头同步给 store（同 openFile，防面包屑/大纲活动项沿用上一文件偏移）。
    useEditorStore.getState().setCursor(view.state.selection.main.head);
    syncCitations(view); // 引用镜像（ZOT-03）
    rebaseWordCount(view); // 字数基线（CREA-04），同 openFile
    syncSceneSummary(view); // 场景概要镜像（CREA-05），同 openFile
  });
  useEditorStore.getState().setActive(path);
}

/** 切走当前文件前，把 view.state 快照与当前 scrollTop 存入缓存（含光标/选区/undo + 滚动位置）。 */
export function snapshotBeforeSwitch(view: EditorView, path: string): void {
  cache.set(path, view.state);
  scrollCache.set(path, scrollContainer(view).scrollTop);
  snapshotRenderMode(view, path);
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
  disposeRenderMode(path);
}

/**
 * 切库重归位：把某 path 的 EditorState / 滚动 / renderMode 缓存整体迁到新 key
 * （保留未落盘编辑、撤销历史、光标/选区、滚动位置）。库内相对键 ↔ 库外绝对键互转时调用。
 * 缓存缺失（活动文件尚未快照入缓存）时无操作——其内容仍在 live view，由调用方先快照。
 */
export function rekeyState(oldPath: string, newPath: string): void {
  if (oldPath === newPath) return;
  const st = cache.get(oldPath);
  if (st !== undefined) {
    cache.set(newPath, st);
    cache.delete(oldPath);
  }
  const top = scrollCache.get(oldPath);
  if (top !== undefined) {
    scrollCache.set(newPath, top);
    scrollCache.delete(oldPath);
  }
  rekeyRenderMode(oldPath, newPath);
}

/** 仅供测试：清空缓存以隔离用例。 */
export function __clearCacheForTest(): void {
  cache.clear();
  scrollCache.clear();
  clearRenderModeCache();
}
