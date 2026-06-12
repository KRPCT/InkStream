import { useCallback, useEffect, useMemo, useRef } from 'react';
import ProbeZone from './ProbeZone';
import { ZONES } from './imeProbeZones';
import { useImeProbeStore } from './useImeProbeStore';

/**
 * IME 输入探针：A–H 二分定位器 + I/J/K 候选解法验证台（R2/R3，dev-only 覆盖面板）。
 *
 * A–H 从「裸 div / textarea 基线」单调爬升到「CM6 完整 baseExtensions」，每区只比前一区多挂一层嫌疑物，
 * 打一轮拼音锁定第一个失效区。I/J/K 是基于「焦点落定后首次组合被吞」结论的三种候选解法受试区——I 焦点
 * 循环、J contenteditable 翻转、K textarea 中继（详见 imeProbeZones.ts / imeMitigations.ts）。
 *
 * 纪律：区间切换走「转焦」按钮程序化转焦（不要点击输入区本身污染实验）；但 CM 区是例外——既要测程序化
 * 聚焦、又要测真实点击两条路径，故 CM 区额外允许「也可直接点击」（说明里写清先转焦打一次、再点击打一次）。
 *
 * 整体 DEV-only：App.tsx 单点 `import.meta.env.DEV && <ImeProbe />` 门控；探针代码全集中 dev/，可整目录删。
 */

export default function ImeProbe() {
  const open = useImeProbeStore((s) => s.open);
  if (!open) return null;
  return <ImeProbePanel />;
}

function ImeProbePanel() {
  const close = useImeProbeStore((s) => s.close);
  const refs = useRef<Record<string, HTMLElement | null>>({});

  // 挂载即程序化转焦到 A 区（基线判定门：程序化聚焦下 textarea 是否武装 IME）。
  useEffect(() => {
    refs.current.A?.focus();
  }, []);

  // 每区一个稳定的 register 回调（按 id 记忆）——绝不每渲染新建，否则会反复重挂 ProbeZone 的 effect
  // （重建 throwaway EditorView，污染日志）。ZONES 是模块级常量，registrars 一次性建好即定。
  const registrars = useMemo(() => {
    const map: Record<string, (el: HTMLElement | null) => void> = {};
    for (const z of ZONES) {
      map[z.id] = (el) => {
        refs.current[z.id] = el;
      };
    }
    return map;
  }, []);

  const focusZone = useCallback((id: string) => {
    refs.current[id]?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-label="IME 输入探针"
      className="fixed inset-0 z-[9999] flex flex-col gap-3 overflow-auto border-b border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-4 [box-shadow:var(--shadow-popup)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-[13px] leading-snug font-bold text-[var(--text-normal)]">
            每区先用按钮转焦打一次拼音，再直接点击该区打一次；记录每区两种路径下中文能否上屏。区间切换默认只用
            下方「转焦」按钮（不要点击输入区本身）——CM 区例外：标注「也可直接点击」，两条路径都要各打一次。
          </p>
          <p className="text-[12px] leading-snug font-semibold text-[var(--interactive-accent)]">
            I/J 重点测试：点击该区后<strong>第一次</strong>打拼音是否直接成功（不再需要重试）；K 区直接打字即可。
            M 区（K 重做）：点击 M 区文本或「转焦到 M」（焦点应落中继 textarea）→ 直接打拼音「nihao」→
            看 M 区编辑器与下方 doc 行是否出现「你好」。
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          className="shrink-0 cursor-pointer rounded-[6px] border border-[var(--background-modifier-border)] px-2 py-1 text-[12px] text-[var(--text-muted)]"
        >
          关闭
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {ZONES.map((z) => (
          <button
            key={z.id}
            type="button"
            onClick={() => focusZone(z.id)}
            className="cursor-pointer rounded-[6px] border border-[var(--background-modifier-border)] px-2 py-1 text-[12px] text-[var(--text-normal)] hover:border-[var(--interactive-accent)] hover:text-[var(--interactive-accent)]"
          >
            转焦到 {z.id}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-4">
        {ZONES.map((z) => (
          <ProbeZone key={z.id} spec={z} register={registrars[z.id]} />
        ))}
      </div>
    </div>
  );
}
