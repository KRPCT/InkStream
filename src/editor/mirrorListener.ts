import { EditorView } from '@codemirror/view';
import { scheduleAutosave } from '../stores/autosave';
import { useEditorStore } from '../stores/useEditorStore';
import { isComposing } from './composition';
import { syncCitations } from './citations';
import { syncRichtext } from './editorState';
import { reconfigureLanguageFromDoc } from './languages';
import { syncOutline } from './outline';
import { syncWordCount } from './wordCount';

/**
 * store 单向镜像 listener（P0 修复，PROD-RELAY-DESIGN §0）。
 *
 * 原实现把本 listener 只拼进 useCodeMirror 的初始 EditorState；而 openFile/switchToTab/
 * reloadFromDisk 换装用裸 baseExtensions——EditorView.updateListener 是 state 级 facet，
 * setState 后旧 state 的 listener 不再被读取，第一次打开文件即失联（markDirty/
 * scheduleAutosave/语言热切/richtext 镜像全断）。下沉 baseExtensions 后每个 EditorState
 * 天然在册（铁律 0：状态级扩展一律进 baseExtensions）。
 *
 * 镜像纪律（Pattern 3）：docChanged → markDirty(activePath)；selectionSet/docChanged →
 * setCursor(head)。store 永不回写 CM。
 *
 * IME（铁律 4 双判）：docChanged 的重副作用块（markDirty / scheduleAutosave /
 * reconfigureLanguageFromDoc / syncRichtext）在 isComposing(u.view) 期间一律跳过——组合期
 * 每个候选键击都打 docChanged，per-keystroke 跑 React/reconfigure/落盘会拖垮合成并与 CM6
 * 合成保护抢节点；改在组合结束的提交事务（composing 已归 false）上一次性触发。判据经
 * composition 门双判（view.composing‖frozenFlag）；中继架构下组合移入 textarea，组合期
 * CM 零事务，本守卫退化为 flag 关闭回退路径的保障（无害保留）。setCursor 廉价可留。
 */
export const mirrorListener = EditorView.updateListener.of((u) => {
  const activePath = useEditorStore.getState().activePath;
  if (u.docChanged && !isComposing(u.view) && activePath) {
    useEditorStore.getState().markDirty(activePath);
    // 编辑触发防抖自动落盘（D-02 原子写，500ms 防抖合并）。
    scheduleAutosave(activePath);
    // 手动编辑 frontmatter language 行 → 头部语言变化即热切（D-13 文档单一真相源）。
    // reconfigure 只发 effect（非 docChange），不会自激 updateListener。
    reconfigureLanguageFromDoc(u.view, activePath);
    // richtext 工具条显隐镜像（D-14）：单向自 CM 写入 store，与 dirty/cursor 同纪律。
    syncRichtext(u.view);
    // 大纲镜像（RightPanel 大纲 tab）：标题随编辑增删，同纪律单向写入 store（变化才更新）。
    syncOutline(u.view);
    // 引用镜像（ZOT-03，RightPanel 引用 tab）：[@key] 随编辑增删，同纪律单向写入 store。
    syncCitations(u.view);
    // 字数镜像（CREA-04）：编辑累加今日净写入（换日重置），单向写入 store。
    syncWordCount(u.view);
  }
  if (u.selectionSet || u.docChanged) {
    useEditorStore.getState().setCursor(u.state.selection.main.head);
  }
});
