import { create } from 'zustand';

/** 首次引导步数（与 OnboardingOverlay 的 STEPS 长度一致）。 */
export const ONBOARDING_STEP_COUNT = 4;
const SEEN_KEY = 'inkstream.onboarded';

interface OnboardingState {
  active: boolean;
  step: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  finish: () => void;
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* localStorage 不可用：下次仍会引导，无害 */
  }
}

/** 首次引导状态（簇③）。完成/跳过即标记 seen，不再自动弹。 */
export const useOnboardingStore = create<OnboardingState>((set) => ({
  active: false,
  step: 0,
  start: () => set({ active: true, step: 0 }),
  next: () =>
    set((s) => {
      if (s.step >= ONBOARDING_STEP_COUNT - 1) {
        markSeen();
        return { active: false, step: 0 };
      }
      return { step: s.step + 1 };
    }),
  prev: () => set((s) => ({ step: Math.max(0, s.step - 1) })),
  finish: () => {
    markSeen();
    set({ active: false, step: 0 });
  },
}));

/** App 启动调用：首次（未引导过）自动开引导。命令「重新引导」直接调 start()。 */
export function initOnboarding(): void {
  let seen: boolean;
  try {
    seen = localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    seen = false;
  }
  if (!seen) useOnboardingStore.getState().start();
}
