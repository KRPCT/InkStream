import { useCallback, useEffect, useRef, useState } from 'react';
import { useImeProbeStore } from './useImeProbeStore';

/**
 * IME 输入探针（R2 go/no-go 实验，dev-only 覆盖面板）。
 * 三个并排受试区：程序化聚焦的 <textarea>（判定门）、<input>、对照组 contentEditable <div>。
 * 每区实时事件日志（最近 20 条 composition/input/keydown），日志面板防误触不夺焦。
 * 受试区切换全程程序化转焦——禁止用户点受试区本身（点了即污染实验）。
 * 零侵入：不接任何生产输入路径，探针代码集中 dev/ 目录便于整体删除。
 */

type Zone = 'textarea' | 'input' | 'div';

interface LogEntry {
  seq: number;
  type: string;
  detail: string;
}

const ZONES: { id: Zone; label: string }[] = [
  { id: 'textarea', label: 'textarea（程序化聚焦·判定门）' },
  { id: 'input', label: 'input（程序化聚焦）' },
  { id: 'div', label: 'contentEditable（对照组·预期失效）' },
];

export default function ImeProbe() {
  const open = useImeProbeStore((s) => s.open);
  if (!open) return null;
  return <ImeProbePanel />;
}

/** 单受试区的事件日志：返回 push 回调与最近 20 条快照。 */
function useEventLog(): { entries: LogEntry[]; push: (type: string, detail: string) => void } {
  const seqRef = useRef(0);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const push = useCallback((type: string, detail: string) => {
    setEntries((prev) => [{ seq: (seqRef.current += 1), type, detail }, ...prev].slice(0, 20));
  }, []);
  return { entries, push };
}

function ImeProbePanel() {
  const close = useImeProbeStore((s) => s.close);
  const [active, setActive] = useState<Zone>('textarea');
  const refs = useRef<Record<Zone, HTMLElement | null>>({ textarea: null, input: null, div: null });

  // 挂载即程序化聚焦 textarea（这正是要测的：程序化聚焦下 textarea 是否武装 IME）。
  useEffect(() => {
    refs.current.textarea?.focus();
  }, []);

  const focusZone = useCallback((zone: Zone) => {
    setActive(zone);
    refs.current[zone]?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-label="IME 输入探针"
      className="fixed inset-x-0 top-0 z-[9999] flex flex-col gap-3 border-b border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-4 [box-shadow:var(--shadow-popup)]"
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] leading-snug font-bold text-[var(--text-normal)]">
          实验步骤：打开后直接打拼音「测试」与连续「咕咕咕」，不要点击输入区。切换受试区只用下方按钮。
        </p>
        <button
          type="button"
          onClick={close}
          className="shrink-0 cursor-pointer rounded-[6px] border border-[var(--background-modifier-border)] px-2 py-1 text-[12px] text-[var(--text-muted)]"
        >
          关闭
        </button>
      </div>

      <div className="flex gap-2">
        {ZONES.map((z) => (
          <button
            key={z.id}
            type="button"
            data-active={active === z.id}
            onClick={() => focusZone(z.id)}
            className="cursor-pointer rounded-[6px] border border-[var(--background-modifier-border)] px-2 py-1 text-[12px] text-[var(--text-normal)] data-[active=true]:border-[var(--interactive-accent)] data-[active=true]:text-[var(--interactive-accent)]"
          >
            转焦到 {z.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {ZONES.map((z) => (
          <ProbeZone
            key={z.id}
            zone={z.id}
            label={z.label}
            register={(el) => {
              refs.current[z.id] = el;
            }}
          />
        ))}
      </div>
    </div>
  );
}

interface ProbeZoneProps {
  zone: Zone;
  label: string;
  register: (el: HTMLElement | null) => void;
}

function ProbeZone({ zone, label, register }: ProbeZoneProps) {
  const { entries, push } = useEventLog();

  const onComposition = (e: React.CompositionEvent) => push(e.type, `data=${JSON.stringify(e.data)}`);
  const onInput = (e: React.FormEvent) => {
    const native = e.nativeEvent as InputEvent;
    push('input', `data=${JSON.stringify(native.data)} isComposing=${native.isComposing}`);
  };
  const onKeyDown = (e: React.KeyboardEvent) =>
    push('keydown', `key=${e.key} isComposing=${e.nativeEvent.isComposing}`);

  const fieldClass =
    'w-full rounded-[6px] border border-[var(--background-modifier-border)] bg-[var(--background-secondary)] px-2 py-1 text-[13px] text-[var(--text-normal)] outline-none';

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] font-semibold text-[var(--text-muted)]">{label}</p>
      {zone === 'textarea' && (
        <textarea
          ref={register as (el: HTMLTextAreaElement | null) => void}
          aria-label="textarea 受试区"
          rows={2}
          className={fieldClass}
          onCompositionStart={onComposition}
          onCompositionUpdate={onComposition}
          onCompositionEnd={onComposition}
          onInput={onInput}
          onKeyDown={onKeyDown}
        />
      )}
      {zone === 'input' && (
        <input
          ref={register as (el: HTMLInputElement | null) => void}
          type="text"
          aria-label="input 受试区"
          className={fieldClass}
          onCompositionStart={onComposition}
          onCompositionUpdate={onComposition}
          onCompositionEnd={onComposition}
          onInput={onInput}
          onKeyDown={onKeyDown}
        />
      )}
      {zone === 'div' && (
        <div
          ref={register as (el: HTMLDivElement | null) => void}
          role="textbox"
          aria-label="contentEditable 受试区"
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
          className={`min-h-[2.5rem] ${fieldClass}`}
          onCompositionStart={onComposition}
          onCompositionUpdate={onComposition}
          onCompositionEnd={onComposition}
          onInput={onInput}
          onKeyDown={onKeyDown}
        />
      )}
      <ul
        aria-label={`${label} 事件日志`}
        // 防误触：点日志不夺焦（preventDefault 阻止 mousedown 转移焦点，保护实验）。
        onMouseDown={(e) => e.preventDefault()}
        className="h-32 overflow-auto rounded-[6px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-1 font-mono text-[11px] text-[var(--text-muted)]"
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
