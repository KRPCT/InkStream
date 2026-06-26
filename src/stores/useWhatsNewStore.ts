import { create } from 'zustand';
import { CHANGELOG, changelogFor, type ChangelogEntry } from '../data/changelog';
import { saveLastSeenVersion } from '../ipc/settings';

/**
 * 更新公告（What's New）状态层。会话内内存态 + 一次落盘（已见版本）。
 *
 * 两个入口：
 * - showFor（启动）：当前版本 !== 已见版本时展示当前版本公告并落盘已见——覆盖「发版后首启」与
 *   「更新重启后首启」两个时机；major/minor 级别附恭喜动效。无公告条目的版本只落盘不弹（避免重复检查）。
 * - showLatest（手动，菜单/命令）：展示最新一条公告，不放动效。
 *
 * 非 React 模块（App 启动副作用 / 命令）经 getState() 调用（同 useUpdaterStore 纪律）。
 */
interface WhatsNewState {
  open: boolean;
  entry: ChangelogEntry | null;
  celebrate: boolean;
  showFor: (version: string, lastSeen: string | null) => void;
  showLatest: () => void;
  close: () => void;
}

export const useWhatsNewStore = create<WhatsNewState>((set) => ({
  open: false,
  entry: null,
  celebrate: false,

  showFor: (version, lastSeen) => {
    if (version === lastSeen) return; // 已展示过该版本
    void saveLastSeenVersion(version); // 标记已见（无论有无公告条目，避免下次重复检查）
    const entry = changelogFor(version);
    if (!entry) return; // 该版本无公告条目（如遗漏的补丁）→ 不弹
    set({ open: true, entry, celebrate: entry.level === 'major' || entry.level === 'minor' });
  },

  showLatest: () => {
    set({ open: true, entry: CHANGELOG[0] ?? null, celebrate: false });
  },

  close: () => set({ open: false, celebrate: false }),
}));
