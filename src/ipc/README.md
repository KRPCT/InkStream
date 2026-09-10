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
- 文件读取入口 `readFile`、`readFileBytes`、`readImageBytes` 已统一经 `read_file_stream` 回传。
  兼容用的旧读取命令会拒绝实际 JSON 编码超过 1MiB 的结果。

## 文件读取协议

控制消息使用小 JSON；数据帧使用 Raw 字节，前 8 字节为小端文件偏移，正文块最大 256KiB。
Rust 的未确认窗口最大 1MiB，前端按已消费字节确认；两端各限制 4 个活跃读取。
调用方可传 `{ signal }` 取消，排队和读取共享 120 秒总期限，读取阶段 15 秒无进度即失败。
文本和阅读文件上限 100MiB，图片上限 25MiB；完整长度、顺序和文本 UTF-8 校验成功后才返回结果。

原生读取完成与编辑器排版是两个阶段。上述传输约束不能代替大文档解析、输入和渲染的实际测量。

## 对应 Rust 侧形态

`invokeStreamed` 假定 Rust command 接收一个名为 `channel` 的 `tauri::ipc::Channel<T>` 参数，
分块调用 `channel.send(chunk)` 回传，最终返回值经 `Result` 正常返回。
