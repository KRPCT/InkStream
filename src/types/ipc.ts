/** 单条 IPC command 的形状：参数与返回值。 */
export interface IpcCommandEntry {
  args: Record<string, unknown> | undefined;
  result: unknown;
}

/**
 * IPC command 注册表：command 名 -> { args; result } 映射。
 * Phase 1 无自定义 Rust command，骨架先立；新增 Rust command 时在此登记，
 * `src/ipc/invoke.ts` 的泛型签名即获得端到端类型约束。
 *
 * 示例（未来形态）：
 * interface IpcCommands {
 *   read_note: { args: { path: string }; result: string };
 * }
 */
export type IpcCommands = Record<never, IpcCommandEntry>;
