import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CM_CONTENT_ATTRS, CM_CONTENT_STYLE } from './cmContentAttrs';
import type { ZoneSpec } from './imeProbeZones';
import { describeEvent, PROBE_EVENTS, useEventLog } from './useEventLog';

/**
 * 单受试区渲染 + 实时事件日志（R2 二分探针）。
 *
 * 三类挂载：
 *   textarea / div / div-cm-attrs — 渲染普通 DOM 元素；
 *   cm — 在容器内 new EditorView（throwaway）：卸载 destroy，绝不 setView()（不碰单内核句柄）。
 *
 * 事件监听一律走「捕获阶段 addEventListener」挂到受试区的「可聚焦/可输入元素」（textarea/div 本身，
 * 或 CM 的 contentDOM）——捕获阶段先于 CM 自身处理，纯旁路记录，绝不 preventDefault、绝不干扰管线。
 * register(el) 把该可聚焦元素上报面板，供「转焦」按钮程序化 focus。
 */

interface ProbeZoneProps {
  spec: ZoneSpec;
  register: (el: HTMLElement | null) => void;
}

export default function ProbeZone({ spec, register }: ProbeZoneProps) {
  const { entries, push } = useEventLog();
  const hostRef = useRef<HTMLDivElement | null>(null);

  // 捕获阶段旁路监听：挂到 target 元素，记录六类事件，不干扰 CM/原生处理。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let view: EditorView | null = null;
    let target: HTMLElement | null = null;
    // 候选解法接线（I/J/K）的 cleanup：CM 区 spec.setup 返回，卸载时先于 view.destroy 调。
    let teardownSetup: (() => void) | null = null;

    if (spec.kind === 'cm') {
      // throwaway view：仅本区生命周期持有，卸载 destroy（不进任何 store/全局句柄）。
      view = new EditorView({
        parent: host,
        state: EditorState.create({ doc: '在此输入中文', extensions: spec.extensions?.() ?? [] }),
      });
      target = view.contentDOM;
      // I/J/K/M 候选解法：view 就绪后挂命令式接线，返回 cleanup 或 ZoneWiring。
      // M 区返回 ZoneWiring：register/转焦/事件日志全部对准其 input（中继 textarea）——修 K 的
      // 「探头与转焦都指向不可聚焦 contentDOM」接线错误（H-relay-design 根因 1/2）。
      const wiring = spec.setup?.(view, host) ?? null;
      if (typeof wiring === 'function') {
        teardownSetup = wiring;
      } else if (wiring) {
        teardownSetup = wiring.teardown;
        target = wiring.input;
      }
    } else {
      target = host.querySelector<HTMLElement>('[data-probe-input]');
    }

    register(target);

    const listener = (e: Event) => push(e.type, describeEvent(e));
    for (const name of PROBE_EVENTS) target?.addEventListener(name, listener, { capture: true });

    return () => {
      for (const name of PROBE_EVENTS)
        target?.removeEventListener(name, listener, { capture: true });
      register(null);
      teardownSetup?.();
      view?.destroy();
    };
    // spec 在面板内稳定不变（模块级常量）；register/push 稳定（useCallback）。
  }, [spec, register, push]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] leading-snug font-semibold text-[var(--text-normal)]">{spec.label}</p>
      <p className="text-[11px] leading-snug text-[var(--text-muted)]">{spec.hypothesis}</p>
      {spec.kind === 'cm' && (
        <p className="text-[11px] font-semibold text-[var(--interactive-accent)]">
          先用按钮转焦打一次，再直接点击该区打一次（程序化 vs 真实点击两路径都要记录）。
        </p>
      )}
      <div ref={hostRef} className="cm-probe-host">
        {renderInput(spec)}
      </div>
      <ul
        aria-label={`${spec.id} 区事件日志`}
        // 防误触：点日志不夺焦（保护正在进行的转焦/点击路径实验）。
        onMouseDown={(e) => e.preventDefault()}
        className="h-28 overflow-auto rounded-[6px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-1 font-mono text-[11px] text-[var(--text-muted)]"
      >
        {entries.map((entry) => (
          <li key={entry.seq}>
            {entry.type} · {entry.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

const FIELD_CLASS =
  'block w-full rounded-[6px] border border-[var(--background-modifier-border)] bg-[var(--background-secondary)] px-2 py-1 text-[13px] text-[var(--text-normal)] outline-none';

/** 渲染受试区的可输入元素（CM 区由 useEffect 注入，故此处只渲染容器）。 */
function renderInput(spec: ZoneSpec) {
  if (spec.kind === 'textarea') {
    return (
      <textarea data-probe-input aria-label={`${spec.id} 受试区`} rows={2} className={FIELD_CLASS} />
    );
  }
  if (spec.kind === 'div') {
    return (
      <div
        data-probe-input
        aria-label={`${spec.id} 受试区`}
        role="textbox"
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
        className={`min-h-[2.5rem] ${FIELD_CLASS}`}
      />
    );
  }
  if (spec.kind === 'div-cm-attrs') {
    // C 区：照抄 CM6 .cm-content 全套 attributes + lineWrapping 关键样式（来源见 cmContentAttrs.ts）。
    const { className: cmClass, ...cmAttrs } = CM_CONTENT_ATTRS;
    return (
      <div
        data-probe-input
        aria-label={`${spec.id} 受试区`}
        tabIndex={0}
        suppressContentEditableWarning
        {...cmAttrs}
        className={`min-h-[2.5rem] ${FIELD_CLASS} ${cmClass}`}
        style={CM_CONTENT_STYLE}
      />
    );
  }
  // cm 区：容器留空，EditorView 在 useEffect 内挂入 hostRef。
  return null;
}
