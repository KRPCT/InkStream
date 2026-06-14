import { create } from 'zustand';

/** 帮助/教程主题（簇③）。 */
export type HelpTopic = 'start' | 'versioning' | 'branching' | 'sync' | 'shortcuts';

interface HelpState {
  open: boolean;
  topic: HelpTopic;
  openHelp: (topic?: HelpTopic) => void;
  closeHelp: () => void;
  setTopic: (topic: HelpTopic) => void;
}

/** 帮助模态开关 + 当前主题（纯 UI 态）。 */
export const useHelpStore = create<HelpState>((set) => ({
  open: false,
  topic: 'start',
  openHelp: (topic) => set(topic ? { open: true, topic } : { open: true }),
  closeHelp: () => set({ open: false }),
  setTopic: (topic) => set({ topic }),
}));
