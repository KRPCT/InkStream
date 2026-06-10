# src/ipc/ — Tauri IPC 收口层

本目录是前端**唯一**允许 `import '@tauri-apps/api/*'` 与 `import '@tauri-apps/plugin-*'` 的层，
由 `eslint.config.js` 的 `no-restricted-imports` 规则机器强制（`src/ipc/**` 豁免）。

## 使用约定

- 业务代码调用 Rust command：经 `invoke.ts` 的类型化 `invoke()`；
  command 名与参数/返回值类型在 `src/types/ipc.ts` 的 `IpcCommands` 中登记。
- 窗口控制（最小化/最大化/关闭/显示/主题订阅）：经 `window.ts` 的 `windowControls`。

## Channel 红线（硬规则）

**单次 invoke 负载 > 1MB 必须改走 Channel（`invokeStreamed`）。**

- 判定方法：对负载做序列化后字节数估算（`new TextEncoder().encode(JSON.stringify(payload)).length`，
  二进制负载按 `byteLength` 计）；估算值超过 1MB（1,048,576 字节）即触发红线。
- 原因：Tauri IPC 单次消息走 JSON 序列化桥，超大负载会阻塞 webview 主线程并放大内存峰值；
  Channel 分块流式回传可保持 UI 响应。
- 运行时断言（payload 估算 + 越线告警）推迟到 Phase 2 出现首个真实大负载时落地
  （01-RESEARCH.md Open Question 3 结论）；本阶段以本文档 + `invokeStreamed` 骨架立约。

## 对应 Rust 侧形态

`invokeStreamed` 假定 Rust command 接收一个名为 `channel` 的 `tauri::ipc::Channel<T>` 参数，
分块调用 `channel.send(chunk)` 回传，最终返回值经 `Result` 正常返回。
