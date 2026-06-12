import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { history, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { destroyTestView, makeTestView } from '../../../test/composition';
import { extensionsForLanguage } from '../../languages';
import { TaskCheckboxWidget } from './TaskCheckboxWidget';

/**
 * 任务复选框 widget 回归门（EDIT-03 / D-09 / T-03-20）。
 *
 * 断言四件事：
 *   1. toDOM 返回 input[type=checkbox]，checked 反映状态；
 *   2. mousedown：preventDefault（不夺焦点/不移光标）+ dispatch 仅改 TaskMarker 中间单字符
 *      （from:pos+1,to:pos+2 → ' '/'x'，范围固定不可扩展，T-03-20）；
 *   3. 改写经 history（dispatch 后 undo 回原文，Ctrl+Z 可撤销）；
 *   4. eq 按 checked+pos；ignoreEvent 返回 false（widget 自己收事件）。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

/** 构建含 markdown(GFM) + history 的真实 view（history 供 undo 断言，对齐编辑器 baseExtensions）。 */
function taskView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), history()]);
}

describe('TaskCheckboxWidget.toDOM', () => {
  it('未勾：input[type=checkbox] 且 checked=false', () => {
    const dom = new TaskCheckboxWidget(false, 2).toDOM(taskView('- [ ] todo'));
    const input = dom as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('checkbox');
    expect(input.checked).toBe(false);
  });

  it('已勾：checked=true', () => {
    const dom = new TaskCheckboxWidget(true, 2).toDOM(taskView('- [x] done')) as HTMLInputElement;
    expect(dom.checked).toBe(true);
  });
});

describe('TaskCheckboxWidget mousedown 改写（T-03-20 范围固定）', () => {
  it('未勾 mousedown → TaskMarker 中间字符改为 x，且仅改 1 字符', () => {
    view = taskView('- [ ] todo');
    // TaskMarker 在 [2-5] "[ ]"；中间空格字符在 pos 3（from:pos+1）。
    const dom = new TaskCheckboxWidget(false, 2).toDOM(view);
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    dom.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe('- [x] todo');
  });

  it('已勾 mousedown → TaskMarker 中间字符改为空格', () => {
    view = taskView('- [x] done');
    const dom = new TaskCheckboxWidget(true, 2).toDOM(view);
    dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe('- [ ] done');
  });

  it('改写走 history：dispatch 后 undo 回原文（Ctrl+Z 可撤销）', () => {
    view = taskView('- [ ] todo');
    const dom = new TaskCheckboxWidget(false, 2).toDOM(view);
    dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe('- [x] todo');

    // 经 history undo 命令回滚（与 Ctrl+Z 同条路径）。
    undo(view);
    expect(view.state.doc.toString()).toBe('- [ ] todo');
  });
});

describe('TaskCheckboxWidget 陈旧 pos 校验（WR-05：组合期 map 后 pos 错位则放弃改写）', () => {
  it('pos 仍指向 TaskMarker → 正常翻转', () => {
    view = taskView('- [ ] todo');
    const dom = new TaskCheckboxWidget(false, 2).toDOM(view);
    dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe('- [x] todo');
  });

  it('pos 已错位（不再是 `[?]` 形状）→ 放弃改写，doc 不变（绝不盲改无关字符）', () => {
    // 模拟陈旧 widget：doc 中 pos 2 处已不是 TaskMarker（文档已被改写但 widget pos 未更新）。
    view = taskView('hello world here');
    const before = view.state.doc.toString();
    // widget 仍持旧 pos 2，但 doc[2..5]="llo" 非 `[?]`：校验失败，dispatch 被放弃。
    const dom = new TaskCheckboxWidget(false, 2).toDOM(view);
    dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe(before);
  });

  it('pos 越界（超出 doc 长度）→ 放弃改写，不抛错', () => {
    view = taskView('- [ ] x');
    const before = view.state.doc.toString();
    const dom = new TaskCheckboxWidget(false, 999).toDOM(view);
    expect(() =>
      dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })),
    ).not.toThrow();
    expect(view.state.doc.toString()).toBe(before);
  });
});

describe('TaskCheckboxWidget eq / ignoreEvent', () => {
  it('eq 按 checked+pos（同则 true，异则 false）', () => {
    const a = new TaskCheckboxWidget(false, 2);
    expect(a.eq(new TaskCheckboxWidget(false, 2))).toBe(true);
    expect(a.eq(new TaskCheckboxWidget(true, 2))).toBe(false);
    expect(a.eq(new TaskCheckboxWidget(false, 9))).toBe(false);
  });

  it('ignoreEvent 返回 false（widget 自己收 mousedown）', () => {
    expect(new TaskCheckboxWidget(false, 2).ignoreEvent()).toBe(false);
  });
});

describe('TaskCheckboxWidget 源纪律', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/editor/livepreview/widgets/TaskCheckboxWidget.ts'),
    'utf8',
  );

  it('mousedown 含 preventDefault + view.dispatch 改 TaskMarker（from:pos+1,to:pos+2）', () => {
    expect(src).toMatch(/preventDefault/);
    expect(src).toMatch(/dispatch/);
    expect(src).toMatch(/pos\s*\+\s*1/);
    expect(src).toMatch(/pos\s*\+\s*2/);
  });

  it('dispatch 前校验目标位仍是 TaskMarker（WR-05 陈旧 pos 守卫）', () => {
    expect(src).toMatch(/isTaskMarkerAt/);
  });

  it('无硬编码色值（var(--cm-*) 纪律）', () => {
    expect(src).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/);
  });
});
