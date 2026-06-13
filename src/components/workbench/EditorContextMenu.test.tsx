import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as registry from '../../commands/registry';
import type { Command } from '../../types/commands';
import EditorContextMenu from './EditorContextMenu';
import { buildEditorMenu, buildTableMenuEntries } from './editorMenuConfig';

/** 最小命令表（仅覆盖右键菜单引用的 id；title/shortcut 取自 registry）。 */
function makeCommands(ids: string[]): Map<string, Command> {
  return new Map(ids.map((id) => [id, { id, title: id, shortcut: undefined, run: vi.fn() }]));
}

const MENU_IDS = [
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.select-all',
  'edit.find',
  'fmt.bold',
  'fmt.italic',
  'fmt.code',
  'fmt.strike',
  'fmt.link',
  'fmt.image',
  'para.heading-1',
  'para.heading-2',
  'para.heading-3',
  'para.paragraph',
  'para.quote',
  'para.ul',
  'para.ol',
  'para.task',
  'para.table',
  'para.math-block',
];

describe('editorMenuConfig.buildEditorMenu', () => {
  it('结构：剪贴板 + 格式▸/段落▸/插入▸ + 查找（R4 §4.3）', () => {
    const items = buildEditorMenu(makeCommands(MENU_IDS), true, vi.fn());
    const ids = items.map((i) => i.id);
    // 顶层叶子：剪切/复制/粘贴/全选 + 三子菜单 + 查找
    expect(ids).toContain('edit.cut');
    expect(ids).toContain('edit.copy');
    expect(ids).toContain('edit.paste');
    expect(ids).toContain('edit.select-all');
    expect(ids).toContain('ctx-format');
    expect(ids).toContain('ctx-paragraph');
    expect(ids).toContain('ctx-insert');
    expect(ids).toContain('edit.find');
  });

  it('三子菜单 markdown 家族时启用、非 markdown 时 disabled', () => {
    const enabled = buildEditorMenu(makeCommands(MENU_IDS), true, vi.fn());
    const disabled = buildEditorMenu(makeCommands(MENU_IDS), false, vi.fn());
    for (const id of ['ctx-format', 'ctx-paragraph', 'ctx-insert']) {
      expect(enabled.find((i) => i.id === id)?.disabled).toBe(false);
      expect(disabled.find((i) => i.id === id)?.disabled).toBe(true);
    }
  });

  it('插入▸ 含 表格/链接/图片/数学块', () => {
    const items = buildEditorMenu(makeCommands(MENU_IDS), true, vi.fn());
    const insert = items.find((i) => i.id === 'ctx-insert')?.submenu ?? [];
    const insertIds = insert.map((i) => i.id);
    expect(insertIds).toEqual(['para.table', 'fmt.link', 'fmt.image', 'para.math-block']);
  });

  it('叶子选择经 registry.execute(commandId) 并回调 onRun', () => {
    const exec = vi.spyOn(registry, 'execute').mockResolvedValue(undefined);
    const onRun = vi.fn();
    const items = buildEditorMenu(makeCommands(MENU_IDS), true, onRun);
    items.find((i) => i.id === 'edit.copy')?.onSelect?.();
    expect(exec).toHaveBeenCalledWith('edit.copy');
    expect(onRun).toHaveBeenCalledTimes(1);
    exec.mockRestore();
  });
});

describe('editorMenuConfig.buildTableMenuEntries（表格右键，Wave 2 §5）', () => {
  it('ctx 为 null（非表格右键）→ 空数组（不显表格项）', () => {
    expect(buildTableMenuEntries(null, vi.fn())).toEqual([]);
  });

  it('ctx 非空 → 追加分隔 + 「表格」子菜单（行列操作 + 列对齐 + 删整表）', () => {
    const entries = buildTableMenuEntries({ tableFrom: 0, cellIndex: 2 }, vi.fn());
    const table = entries.find((e) => e.id === 'ctx-table');
    expect(table).toBeDefined();
    const subIds = (table!.submenu ?? []).filter((s) => !s.separator).map((s) => s.label);
    expect(subIds).toContain('在上方插入行');
    expect(subIds).toContain('删除当前列');
    expect(subIds).toContain('本列右对齐'); // 对齐正名「列对齐」（TABLE-REDESIGN §4a）。
    expect(subIds).toContain('删除整张表'); // 删格唯一入口（§5.2）。
  });
});

describe('EditorContextMenu', () => {
  let disposers: Array<() => void> = [];

  beforeEach(() => {
    disposers = MENU_IDS.map((id) =>
      registry.register({ id, title: id, run: vi.fn() }),
    );
  });

  afterEach(() => {
    disposers.forEach((d) => d());
  });

  it('固定定位到 contextmenu 坐标', () => {
    render(<EditorContextMenu position={{ x: 120, y: 80 }} onClose={vi.fn()} />);
    const menu = screen.getByRole('menu', { name: '编辑器操作' });
    expect(menu).toHaveStyle({ left: '120px', top: '80px' });
  });

  it('渲染剪贴板顶层项 + 三子菜单标签', () => {
    render(<EditorContextMenu position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    expect(screen.getByRole('menuitem', { name: '剪切' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /格式/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /段落/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /插入/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '查找' })).toBeInTheDocument();
  });

  it('点击叶子项经 registry.execute 派发并 onClose 关闭', () => {
    const exec = vi.spyOn(registry, 'execute').mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<EditorContextMenu position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('menuitem', { name: '复制' }));
    expect(exec).toHaveBeenCalledWith('edit.copy');
    expect(onClose).toHaveBeenCalled();
    exec.mockRestore();
  });
});
