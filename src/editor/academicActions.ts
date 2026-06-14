import { zoteroCayw } from '../ipc/zotero';
import { showToast } from '../stores/useToastStore';
import { getView } from './viewHandle';

/**
 * 学术写作动作（Phase 8 ZOT / ACAD）。经 getView() 取单内核 EditorView（EditorView 不进 store 纪律）。
 */

function errText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
}

/**
 * 并发守卫：CAYW 是 Zotero 的「文字处理器集成命令」，同时只能跑一个——重复触发会撞
 * 「集成命令已在运行」。pending 期间再调直接忽略 + 提示，杜绝叠加。
 */
let citing = false;

/**
 * 插入引用（ZOT-01）：触发 Zotero CAYW picker，用户选完后把返回的 `[@citekey]` 插入光标处。
 * Zotero 未运行 / BBT 未装 / 超时 → 明确错误 toast。用户取消（空串）→ 静默 no-op。
 * 并发守卫：一次只允许一个 CAYW（Zotero 集成命令串行）。
 */
export async function insertCitation(): Promise<void> {
  const view = getView();
  if (!view) return;
  if (citing) {
    showToast('warning', '引用选择已在进行中——请先在 Zotero 选择器里完成或按 Esc 取消。');
    return;
  }
  citing = true;
  let cite: string;
  try {
    cite = await zoteroCayw();
  } catch (e) {
    showToast('error', `插入引用失败：${errText(e)}`);
    return;
  } finally {
    citing = false;
  }
  if (!cite.trim()) return; // 用户取消
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: cite },
    selection: { anchor: from + cite.length },
    scrollIntoView: true,
  });
  view.focus();
}
