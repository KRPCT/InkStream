import { register } from '../../commands/registry';
import type { Command } from '../../types/commands';
import { useImeProbeStore } from './useImeProbeStore';

/**
 * DEV-only 命令「开发：IME 输入探针」（R2 实验入口）。
 * 仅 import.meta.env.DEV 下注册——生产构建不暴露探针命令。
 * 与面板、store 同居 dev/ 目录，R2 实验结束可整目录删除（含 builtins 一处调用点）。
 */
const IME_PROBE_COMMAND: Command = {
  id: 'dev.ime-probe',
  title: '开发：IME 输入探针',
  run: () => useImeProbeStore.getState().toggle(),
};

/**
 * 在 DEV 下注册探针命令，返回 dispose（StrictMode/重复调用安全经 registry 幂等保障）；
 * 非 DEV 返回 no-op，命令不进注册表。
 */
export function registerImeProbeCommand(): () => void {
  if (!import.meta.env.DEV) return () => {};
  return register(IME_PROBE_COMMAND);
}
