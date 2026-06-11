import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * WR-10 回归：typst 动态 import 解析前用户切走语言/文档时，迟到的 reconfigure
 * 不得落到当前（已非 typst）文档上。
 *
 * 通过 mock 'codemirror-lang-typst' 让 import 返回一个可被探测的 typst() 工厂，
 * 并在 import 解析前再次 switchLanguage，断言 typst 工厂从未被用于 reconfigure。
 */

const typstMarker = vi.fn();

vi.mock('codemirror-lang-typst', () => ({
  // typst() 被调用即说明 reconfigure 用到了它（迟到落地）。
  typst: () => {
    typstMarker();
    return [];
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('switchLanguage typst 迟到 reconfigure 守卫（WR-10）', () => {
  it('import 解析前切走语言 → typst 工厂不被应用', async () => {
    const { switchLanguage, langCompartment, extensionsForLanguage } = await import('./languages');
    const view = new EditorView({
      state: EditorState.create({
        doc: '#let x = 1',
        extensions: [langCompartment.of(extensionsForLanguage('markdown'))],
      }),
    });

    // 发起 typst 切换（触发异步 loadTypst）。
    switchLanguage(view, 'typst');
    // 在微任务队列冲刷前立即切到 markdown（generation 递增，使 typst 意图作废）。
    switchLanguage(view, 'markdown');

    // 冲刷所有挂起的微任务（让 mock 的 import 解析）。
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // typst() 工厂绝不应被调用——意图已作废。
    expect(typstMarker).not.toHaveBeenCalled();
    view.destroy();
  });

  it('保持 typst 不切走 → typst 工厂正常应用', async () => {
    const { switchLanguage, langCompartment, extensionsForLanguage } = await import('./languages');
    const view = new EditorView({
      state: EditorState.create({
        doc: '#let x = 1',
        extensions: [langCompartment.of(extensionsForLanguage('markdown'))],
      }),
    });

    switchLanguage(view, 'typst');
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // 未切走：typst 高亮按预期应用。
    expect(typstMarker).toHaveBeenCalled();
    view.destroy();
  });
});
