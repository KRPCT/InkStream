import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../../../test/composition';
import { extensionsForLanguage } from '../../languages';
import { blockExtensions } from '../blockField';
import { tableModelAt } from '../tableModel';
import { buildTableToolbar, markActiveAlign } from './tableToolbar';

/**
 * 表格悬浮工具条回归门（TABLE-WYSIWYG-DESIGN §5 入口 a / Security V5 XSS）。
 *
 * 断言：
 *   1. 结构：含插行/删行/插列/删列/对齐按钮，全 SVG 图标（createElementNS，无 innerHTML）；
 *   2. 无障碍：每个按钮带简体中文 aria-label + title；
 *   3. 点击派发 op：点「在下方插入行」→ doc 多一行（合法 GFM，与 applyTableOp 同源）；
 *   4. mousedown 不夺焦（preventDefault）。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

const DOC = '| a | b |\n| --- | --- |\n| 1 | 2 |';

function ttView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), blockExtensions]);
}

/** 构建工具条挂入容器（getCellIndex 固定返回首个数据格 2）。 */
function mountToolbar(v: EditorView): HTMLElement {
  const container = document.createElement('div');
  return buildTableToolbar(container, 0, v, () => 2);
}

describe('buildTableToolbar 结构 + 无障碍', () => {
  it('含全部操作按钮（插删行列 + 列对齐 + 删整表），按钮带中文 aria-label/title', () => {
    view = ttView(DOC);
    const bar = mountToolbar(view);
    const btns = bar.querySelectorAll('button');
    expect(btns.length).toBe(10); // 插行上/下/删行 + 插列左/右/删列 + 列对齐左/中/右 + 删整表。
    const labels = Array.from(btns).map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('在上方插入行');
    expect(labels).toContain('删除当前列');
    expect(labels).toContain('本列右对齐'); // 对齐正名「列对齐」（TABLE-REDESIGN §4a）。
    expect(labels).toContain('删除整张表'); // 删格唯一入口（§5.2）。
    btns.forEach((b) => {
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.title).toBe(b.getAttribute('aria-label'));
    });
  });

  it('图标全 SVG（createElementNS，无 innerHTML 入按钮）', () => {
    view = ttView(DOC);
    const bar = mountToolbar(view);
    bar.querySelectorAll('button').forEach((b) => {
      const svg = b.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.querySelector('path')).not.toBeNull();
    });
  });

  it('toolbar role + 中文 aria-label', () => {
    view = ttView(DOC);
    const bar = mountToolbar(view);
    expect(bar.getAttribute('role')).toBe('toolbar');
    expect(bar.getAttribute('aria-label')).toBe('表格操作');
  });
});

describe('buildTableToolbar 点击派发 op', () => {
  it('点「在下方插入行」→ doc 多一行（合法 GFM）', () => {
    view = ttView(DOC);
    const bar = mountToolbar(view);
    const btn = Array.from(bar.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === '在下方插入行',
    )!;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const m = tableModelAt(view.state, 0)!;
    expect(m.cells.length).toBe(6); // 表头 2 + 两数据行各 2。
    expect(m.columns).toBe(2);
  });

  it('点「本列右对齐」→ delimiter 变右对齐 GFM 语法', () => {
    view = ttView(DOC);
    const bar = mountToolbar(view);
    const btn = Array.from(bar.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === '本列右对齐',
    )!;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(view.state.doc.toString()).toContain('---:');
  });

  it('点「删除整张表」→ 整表从 doc 移除（删格唯一入口，§5.2）', () => {
    view = ttView('前段\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n后段');
    const tableFrom = tableModelAt(view.state, view.state.doc.toString().indexOf('| a'))!.tableFrom;
    const container = document.createElement('div');
    const bar = buildTableToolbar(container, tableFrom, view, () => 0);
    const btn = Array.from(bar.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === '删除整张表',
    )!;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const text = view.state.doc.toString();
    expect(text).not.toContain('| a | b |');
    expect(text).toContain('前段');
    expect(text).toContain('后段');
    expect(tableModelAt(view.state, text.indexOf('前段'))).toBeNull(); // 已无表。
  });

  it('mousedown 不夺焦（preventDefault）', () => {
    view = ttView(DOC);
    const bar = mountToolbar(view);
    const btn = bar.querySelector('button')!;
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('markActiveAlign 高亮当前列对齐（C）', () => {
  const ACTIVE = 'cm-ink-table-toolbar-btn-active';
  it('居中 → 仅「居中」按钮 active；GFM none 视同左、高亮「左」', () => {
    view = ttView(DOC);
    const bar = mountToolbar(view);
    const has = (a: string) => bar.querySelector(`[data-align="${a}"]`)!.classList.contains(ACTIVE);
    markActiveAlign(bar, 'center');
    expect([has('left'), has('center'), has('right')]).toEqual([false, true, false]);
    markActiveAlign(bar, 'right');
    expect([has('left'), has('center'), has('right')]).toEqual([false, false, true]);
    markActiveAlign(bar, 'none'); // 'none' 渲染视同左 → 高亮「左」。
    expect([has('left'), has('center'), has('right')]).toEqual([true, false, false]);
  });
});
