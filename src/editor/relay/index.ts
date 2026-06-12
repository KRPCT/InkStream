/**
 * 中继总开关（PROD-RELAY-DESIGN §1.3）。
 *
 * 默认开；`VITE_INK_RELAY=0` 一键回退完整旧路径（contentDOM editable 默认 true、
 * 组合冻结门走 contentDOM 事件、view.focus 直焦）。flag 存活一个里程碑，
 * 真机矩阵全绿后随旧路径一并拆除。
 *
 * 本模块只承载 flag，不聚合导出兄弟模块——relayState/relayController/relayFocus
 * 均 import 本 flag，若此处再 re-export 它们会成环。
 */
export const RELAY_ENABLED: boolean =
  (import.meta.env.VITE_INK_RELAY as string | undefined) !== '0';
