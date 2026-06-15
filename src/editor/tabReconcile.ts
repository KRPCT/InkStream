import { useEditorStore } from '../stores/useEditorStore';
import { isDraftPath } from './draftPath';
import { reapplyImageContext, rekeyState } from './editorState';
import { relativeWithin, stripVerbatim } from './pathUtil';

/**
 * 切库后把所有打开的非草稿 tab 重归位到新库语境（#3 数据丢失根治 + #5.5「半改文件不关闭、改非工作区」）。
 *
 * 根因：tab 的 key 是相对 vault 根的路径，切库只换 vault.root、不动 tab，于是旧 tab（旧库内容 + 旧相对键）
 * 一旦 autosave 就落到「新库根 + 同相对路径」覆盖新库文件。重归位把每个 tab 的 key 按其**真实绝对路径**
 * 相对新库重新分类：
 * - 仍落在新库内 → 改相对键（仍属工作区，autosave 走库内相对写）；
 * - 落在新库外 → 改绝对键 + external（autosave 走绝对写到其真实位置，绝不碰新库文件）。
 *
 * EditorState/滚动/renderMode 缓存与 dirty/frozen 标记随键迁移（rekeyState + rehomeTab），未落盘编辑零丢失。
 * 纯按路径计算，不读盘——调用方须在 vault.root 已切到新库后调用（autosave 此刻应处挂起态，见 vaultFlow）。
 */
export function rehomeTabsForVaultSwitch(oldRoot: string, newRoot: string): void {
  // stripVerbatim：库内 tab 重归位为库外时，绝对键须用干净形（去 \\?\），否则 Rust 文件 IO 无法解析。
  const oldBase = stripVerbatim(oldRoot).replace(/\/+$/, '');
  // 快照一次 tab 列表：每个原始 tab 处理一次（rehomeTab 按 oldKey 精确匹配，互不干扰）。
  for (const tab of useEditorStore.getState().tabs) {
    if (isDraftPath(tab.path)) continue; // 草稿与 vault 无关，不动
    // 该 tab 的真实绝对路径：库外 tab 的 key 本就是绝对路径；库内 tab 用旧库根拼相对键。
    const abs = tab.external ? stripVerbatim(tab.path) : `${oldBase}/${tab.path}`;
    const relInNew = relativeWithin(abs, newRoot);
    const newKey = relInNew !== null ? relInNew : abs;
    const external = relInNew === null;
    if (newKey === tab.path) continue; // 分类不变（键不变 ⟺ external 不变）
    rekeyState(tab.path, newKey);
    useEditorStore.getState().rehomeTab(tab.path, newKey, external);
    // rehomeTab 后 activePath 已是 newKey：按新 key 重导图片上下文（活动 view reconfigure + 缓存更新）。
    reapplyImageContext(newKey);
  }
}
