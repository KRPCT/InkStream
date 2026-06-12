import { matchCommands } from '../../commands/match';
import { openFileByPath } from '../../editor/fileOpenFlow';
import { useVaultStore } from '../../stores/useVaultStore';
import type { PaletteItem, PaletteProvider } from '../../types/commands';
import type { FileEntry } from '../../types/vault';

/**
 * 快速打开（Ctrl+P，FILE-03）无前缀 provider：对当前 vault 文件清单做文件名 fuzzy 排序。
 *
 * CJK 命中复用 commands/match.ts 的 uFuzzy（D-07，README unicode 全套选项实测修正），
 * 绝不重写匹配；文件清单同步取自 useVaultStore 的快照（openVaultByPath 打开时填充）。
 */

/** 对文件清单按文件名 fuzzy 排序（复用 match.ts matchCommands，喂文件名 titles）。 */
export function rankFiles(query: string, files: FileEntry[]): FileEntry[] {
  const titles = files.map((f) => f.name);
  return matchCommands(query.trim(), titles).map((i) => files[i]);
}

/** 无前缀快速打开 provider：title=文件名、subtitle=相对路径、id=相对路径。 */
export const fileProvider: PaletteProvider = {
  prefix: '',
  getItems: (query): PaletteItem[] => {
    const { vault, files } = useVaultStore.getState();
    if (!vault) return [];
    return rankFiles(query, files).map((f) => ({
      id: f.path,
      title: f.name,
      subtitle: f.path,
    }));
  },
  onSelect: (id) => {
    void openFileByPath(id);
  },
};
