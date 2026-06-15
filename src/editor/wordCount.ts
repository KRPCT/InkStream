import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { countWords } from '../lib/wordCount';
import { useWordCountStore } from '../stores/useWordCountStore';
import { bodyStart } from './frontmatter';

/**
 * Creative 字数镜像（CREA-04）。activeCount=活动文档正文字数；todayWritten=今日净写入。
 *
 * 「今日净写入」语义（用户决策 #6）：累加编辑产生的净字数增量，换日归零、仅记编辑（切 tab 仅换基线）。
 * 做法：editStep=count−lastActive（lastActive 由 rebaseWordCount 在开/切文档时设为该文档当前字数，
 * 故打开既有文档不会把存量当「今日写入」；后续编辑才累加）。跨文档累计、对切 tab 稳健。
 * 字数规则共用 lib/wordCount.countWords（与章节树每场景计数同源，CREA-01）。
 */

/** 活动文档正文字数（剔除 frontmatter，避 YAML 计入）。 */
export function extractWordCount(state: EditorState): number {
  const text = state.doc.toString();
  return countWords(text.slice(bodyStart(text)));
}

interface WordCountDeps {
  /** 当前日历日键（默认本地日期串；测试注入可控值以验换日重置）。 */
  dayKey: () => string;
}
function defaultDeps(): WordCountDeps {
  return { dayKey: () => new Date().toDateString() };
}
let deps = defaultDeps();
let day = '';
let lastActive = 0;
let todayWritten = 0;

/** 测试注入 dayKey 桩。 */
export function configureWordCount(next: Partial<WordCountDeps>): void {
  deps = { ...deps, ...next };
}

/** 复位（测试 / 切 vault 基线重置）。 */
export function resetWordCount(): void {
  deps = defaultDeps();
  day = '';
  lastActive = 0;
  todayWritten = 0;
}

function mirror(activeCount: number): void {
  const s = useWordCountStore.getState();
  if (s.activeCount !== activeCount || s.todayWritten !== todayWritten) {
    s.report(activeCount, todayWritten);
  }
}

/** docChanged 触发：换日先归零，累加净写入（删减亦计、夹至 ≥0），更新活动字数。 */
export function syncWordCount(view: EditorView): void {
  const count = extractWordCount(view.state);
  const today = deps.dayKey();
  if (today !== day) {
    day = today;
    todayWritten = 0;
  }
  todayWritten += count - lastActive;
  if (todayWritten < 0) todayWritten = 0;
  lastActive = count;
  mirror(count);
}

/** 开/切文档（openFile/switchToTab 换装）触发：仅把基线设为新文档字数，不计入今日写入。 */
export function rebaseWordCount(view: EditorView): void {
  const count = extractWordCount(view.state);
  lastActive = count;
  mirror(count);
}
