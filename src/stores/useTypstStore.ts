import { create } from 'zustand';
import type { FormulaBlock } from '../editor/livepreview/formulaBlocks';

export type TypstBlockStatus = 'empty' | 'loading' | 'compiling' | 'ready' | 'error';
export type TypstPhase = 'idle' | 'paused' | 'loading' | 'compiling' | 'partial' | 'ready' | 'error';
export interface TypstPreviewBlock extends FormulaBlock {
  readonly equationNumber?: number;
  readonly equationLabel?: string;
  readonly status: TypstBlockStatus;
  readonly svg: string | null;
  readonly error: string | null;
}
export interface TypstSnapshot {
  readonly session: number;
  readonly revision: number;
  readonly phase: TypstPhase;
  readonly blocks: readonly TypstPreviewBlock[];
}

export const emptyTypstSnapshot: TypstSnapshot = { session: 0, revision: 0, phase: 'idle', blocks: [] };

/** 编译会话单向写入；不存 EditorView、Worker、Promise 或可回写文档的函数。 */
export const useTypstStore = create<TypstSnapshot>(() => emptyTypstSnapshot);
