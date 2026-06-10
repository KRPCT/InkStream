import { execute } from './registry';

/**
 * window 级单一 keydown 分发器（D-05 VSCode 惯例）：accelerator 字符串 → 命令 id。
 * 面板内部导航键（Up/Down/Enter/Esc）不经此处，由 CommandPalette 自行处理。
 *
 * DEVIATION(D-05): macOS Cmd(Meta) 修饰键映射本阶段不实现，推迟至 macOS 实机
 * 交互测试阶段补齐；spec 层追踪由 Plan 07 specs/01-workbench.spec.md「已知偏差」承载。
 */

const bindings = new Map<string, string>();
let listening = false;

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift'] as const;

/** 把 keydown 事件归一为 'Ctrl+Alt+Shift+KEY'；纯修饰键事件返回 null。 */
export function normalizeEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}

/** 解析 accelerator 字符串为归一形式（修饰序固定 Ctrl,Alt,Shift，主键大写）。 */
function normalizeAccelerator(accelerator: string): string {
  const tokens = accelerator.split('+').map((t) => t.trim());
  const mods = MODIFIER_ORDER.filter((m) => tokens.includes(m));
  const main = tokens.find((t) => !MODIFIER_ORDER.includes(t as (typeof MODIFIER_ORDER)[number]));
  if (!main) throw new Error(`无效快捷键: ${accelerator}`);
  return [...mods, main.length === 1 ? main.toUpperCase() : main].join('+');
}

/** 绑定 accelerator → 命令 id，返回解绑函数。 */
export function bind(accelerator: string, commandId: string): () => void {
  const accel = normalizeAccelerator(accelerator);
  bindings.set(accel, commandId);
  return () => {
    if (bindings.get(accel) === commandId) bindings.delete(accel);
  };
}

function onKeydown(e: KeyboardEvent): void {
  // Pitfall 4：中文 IME 组合中（含旧引擎/WebView 的 keyCode 229）一律不分发
  if (e.isComposing || e.keyCode === 229) return;
  const accel = normalizeEvent(e);
  if (!accel) return;
  const id = bindings.get(accel);
  if (!id) return; // 未绑定组合不拦截默认行为
  e.preventDefault();
  void execute(id);
}

/** 挂载全局监听（幂等），main.tsx 启动时调用一次。 */
export function init(): void {
  if (listening) return;
  window.addEventListener('keydown', onKeydown);
  listening = true;
}

/** 卸载监听并清空绑定（测试复位用）。 */
export function dispose(): void {
  if (listening) {
    window.removeEventListener('keydown', onKeydown);
    listening = false;
  }
  bindings.clear();
}
