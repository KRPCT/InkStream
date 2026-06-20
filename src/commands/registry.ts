import { useSettingsStore } from '../stores/useSettingsStore';
import type { Command } from '../types/commands';
import { record } from './mru';

/**
 * 命令注册表（Pattern 3）：全项目命令统一入口。
 * 模块级单例（Map + 订阅者），不进 Zustand——run handler 不可序列化（Anti-Pattern 看护）。
 * 面板与菜单（Plan 05）均从 getAll() 同源消费（D-02）。
 */

const commands = new Map<string, Command>();
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}

/** 注册命令，返回 dispose（幂等）；重复 id 抛错。 */
export function register(command: Command): () => void {
  if (commands.has(command.id)) {
    throw new Error(`命令 id 重复注册: ${command.id}`);
  }
  commands.set(command.id, command);
  notify();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    commands.delete(command.id);
    notify();
  };
}

/** 注册序返回全部命令（排序语义由消费方决定，见 match.rankCommands）。 */
export function getAll(): Command[] {
  return [...commands.values()];
}

/** 执行命令：记 MRU 后运行 run；未注册 id 静默忽略（防御性）。 */
export async function execute(id: string): Promise<void> {
  const command = commands.get(id);
  if (!command) return;
  // 简易模式：高级命令一律 no-op（统一收口快捷键 / 命令面板 / 菜单点击三条触发路径）。
  if (command.advanced && useSettingsStore.getState().simpleMode) return;
  // 书架未开启：书架命令一律 no-op（同 pandocOnly 门控）。
  if (command.bookshelfOnly && !useSettingsStore.getState().bookshelfEnabled) return;
  record(id);
  await command.run();
}

/** 注册/注销时通知订阅者（菜单、面板据此刷新），返回退订函数。 */
export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
