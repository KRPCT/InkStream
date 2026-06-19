import { describe, expect, it } from 'vitest';
import { ACADEMIC_COMMANDS } from '../../commands/academicCommands';
import { CORE_COMMANDS } from '../../commands/coreCommands';
import { GIT_COMMANDS } from '../../commands/gitCommands';
import type { Command } from '../../types/commands';
import { MENUS, toEntries } from './menuConfig';

/** 用真实命令定义建注册表映射，确保「哪些命令是 advanced」与实际注册一致。 */
const commands = new Map<string, Command>(
  [...CORE_COMMANDS, ...GIT_COMMANDS, ...ACADEMIC_COMMANDS].map((c) => [c.id, c]),
);
const viewGroup = MENUS.find((g) => g.label === '视图')!;

describe('menuConfig.toEntries 简易模式门控', () => {
  it('完整模式保留 Git Graph / 模式子菜单 / 切换文档语言', () => {
    const ids = toEntries(viewGroup, commands, []).map((e) => e.id);
    expect(ids).toContain('git.toggle-graph');
    expect(ids).toContain('submenu-模式');
    expect(ids).toContain('doc.toggle-language');
  });

  it('简易模式隐藏全部 advanced 项与整组 advanced 子菜单，保留基础项', () => {
    const ids = toEntries(viewGroup, commands, [], true).map((e) => e.id);
    expect(ids).not.toContain('git.toggle-graph');
    expect(ids).not.toContain('submenu-模式'); // mode.switch-* 三项皆 advanced → 整项移除
    expect(ids).not.toContain('doc.toggle-language');
    // 基础项不受影响。
    expect(ids).toContain('view.command-palette');
    expect(ids).toContain('view.settings');
    expect(ids).toContain('submenu-外观'); // theme.* 非 advanced，外观子菜单保留
  });

  it('简易模式门控后不留首尾 / 连续分隔线', () => {
    const entries = toEntries(viewGroup, commands, [], true);
    expect(entries[0]?.separator).toBeFalsy();
    expect(entries[entries.length - 1]?.separator).toBeFalsy();
    for (let i = 1; i < entries.length; i++) {
      expect(Boolean(entries[i].separator && entries[i - 1].separator)).toBe(false);
    }
  });
});
