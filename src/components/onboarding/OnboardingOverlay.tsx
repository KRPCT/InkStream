import type { CSSProperties } from 'react';
import { useHelpStore } from '../../stores/useHelpStore';
import { ONBOARDING_STEP_COUNT, useOnboardingStore } from '../../stores/useOnboardingStore';

/**
 * 交互式首次引导（簇③）：spotlight 高亮各入口 + 卡片说明，分步走查。文案非拟人化。
 *
 * 每步可选 selector 指向真实元素：找到则用 box-shadow 挖洞高亮 + 卡片贴近定位；找不到（或无 selector）则居中
 * 半透明遮罩 + 居中卡片（稳健回退，不因元素未渲染而卡死）。完成/跳过标记 seen，不再自动弹。
 */
interface Step {
  selector?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: '欢迎使用 InkStream',
    body: '一个内置 git 版本管理、双向链接与数学渲染的写作环境。下面用几步带你认识关键入口。',
  },
  {
    selector: '[data-onboarding=git-panel]',
    title: '源代码管理面板',
    body: '工作区是 git 仓库时，这里显示当前分支与变更文件，可直接写说明并提交，还能获取/拉取/推送。',
  },
  {
    selector: '[data-testid=git-branch-indicator]',
    title: '分支与 Git Graph',
    body: '左下角显示当前分支。点它进入 Git Graph 查看完整提交历史、右键提交可回滚/分支/合并（再点退出）。',
  },
  {
    title: '设置与帮助',
    body: '按 Ctrl+, 打开设置（主题、自动保存、git 远程方式）。菜单「帮助 ▸ 使用教程」随时查看提交/回滚/分支/合并/多设备同步的图文教学。',
  },
];

function targetRect(selector?: string): DOMRect | null {
  if (!selector) return null;
  const el = document.querySelector(selector);
  return el ? el.getBoundingClientRect() : null;
}

export default function OnboardingOverlay() {
  const active = useOnboardingStore((s) => s.active);
  const step = useOnboardingStore((s) => s.step);
  const next = useOnboardingStore((s) => s.next);
  const prev = useOnboardingStore((s) => s.prev);
  const finish = useOnboardingStore((s) => s.finish);
  if (!active) return null;

  const cur = STEPS[step] ?? STEPS[0];
  const rect = targetRect(cur.selector);
  const last = step >= ONBOARDING_STEP_COUNT - 1;

  // 卡片定位：有目标则贴其下方（靠近视口底则改上方）；无目标则居中。
  const cardStyle: CSSProperties = rect
    ? rect.bottom + 180 < window.innerHeight
      ? { top: rect.bottom + 12, left: Math.min(Math.max(rect.left, 12), window.innerWidth - 332) }
      : { top: Math.max(rect.top - 172, 12), left: Math.min(Math.max(rect.left, 12), window.innerWidth - 332) }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="新手引导">
      {rect ? (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            borderRadius: 8,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
            outline: '2px solid var(--accent)',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
      )}

      <div
        style={cardStyle}
        className="absolute w-80 rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-4 [box-shadow:var(--shadow-popup)]"
      >
        <div className="text-[11px] text-[var(--text-faint)]">
          {step + 1} / {ONBOARDING_STEP_COUNT}
        </div>
        <p className="mt-1 text-[15px] font-semibold text-[var(--text-normal)]">{cur.title}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">{cur.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="text-[12px] text-[var(--text-faint)] hover:text-[var(--text-muted)]"
          >
            跳过
          </button>
          <div className="flex gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={prev}
                className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
              >
                上一步
              </button>
            ) : null}
            <button
              type="button"
              onClick={next}
              className="rounded-[4px] bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-[var(--background-primary)] hover:opacity-90"
            >
              {last ? '完成' : '下一步'}
            </button>
          </div>
        </div>
        {last ? (
          <button
            type="button"
            onClick={() => {
              finish();
              useHelpStore.getState().openHelp('start');
            }}
            className="mt-2 text-[12px] text-[var(--accent)] hover:underline"
          >
            打开完整使用教程 →
          </button>
        ) : null}
      </div>
    </div>
  );
}
