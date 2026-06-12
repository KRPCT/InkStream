import { useCallback, useRef, useState } from 'react';

/**
 * 单受试区的实时事件日志（R2 二分探针，最近 10 条）。
 *
 * 记录 compositionstart/update/end + beforeinput + input + keydown 六类事件，每行带 data 与 isComposing
 * （IME 上屏判据）。push 经 seqRef 自增序号给稳定 key，setEntries 用函数式更新避免闭包陈旧。
 */

export interface LogEntry {
  seq: number;
  type: string;
  detail: string;
}

const MAX_ENTRIES = 10;

export interface EventLog {
  entries: LogEntry[];
  push: (type: string, detail: string) => void;
}

export function useEventLog(): EventLog {
  const seqRef = useRef(0);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const push = useCallback((type: string, detail: string) => {
    setEntries((prev) => [{ seq: (seqRef.current += 1), type, detail }, ...prev].slice(0, MAX_ENTRIES));
  }, []);
  return { entries, push };
}

/** 从原生 DOM 事件提炼一行日志 detail（统一 textarea/div/CM 三类的字段，带 isComposing/data）。 */
export function describeEvent(e: Event): string {
  if (e instanceof CompositionEvent) {
    return `data=${JSON.stringify(e.data)}`;
  }
  if (e instanceof InputEvent) {
    return `data=${JSON.stringify(e.data)} inputType=${e.inputType} isComposing=${e.isComposing}`;
  }
  if (e instanceof KeyboardEvent) {
    return `key=${e.key} isComposing=${e.isComposing}`;
  }
  return '';
}

/** 探针监听的事件名（捕获阶段挂各受试区，不干扰 CM 自身处理）。 */
export const PROBE_EVENTS = [
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'beforeinput',
  'input',
  'keydown',
] as const;
