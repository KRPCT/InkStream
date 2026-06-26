import { openFileAndFind } from '../../editor/fileOpenFlow';
import { useContentSearchStore } from '../../stores/useContentSearchStore';
import type { PaletteItem, PaletteProvider } from '../../types/commands';

/**
 * 全库全文搜索（命令面板 `#` 模式，v1.2 #2a 旗舰雏形，对标 Zed 项目搜索）。
 *
 * 异步 FTS5 查询经 useContentSearchStore 落地（面板侧防抖触发 run）；本 provider 同步读 hits（与同步
 * provider 契约兼容）。title=文件名、subtitle=snippet 上下文（纯文本）。onSelect 打开文件并在「当前文档
 * 真相源」上自校准定位 term（索引可能滞后，复用 v1.1.7 续读锚点纪律）。
 */
export const contentProvider: PaletteProvider = {
  prefix: '#',
  getItems: (): PaletteItem[] =>
    useContentSearchStore.getState().hits.map((h) => ({
      id: h.path,
      title: h.path.split('/').pop() ?? h.path,
      subtitle: h.snippet || h.path,
    })),
  onSelect: (id) => {
    void openFileAndFind(id, useContentSearchStore.getState().term);
  },
};
