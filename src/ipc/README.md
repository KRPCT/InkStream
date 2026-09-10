# src/ipc/ — Tauri IPC 收口层

本目录是前端**唯一**允许 `import '@tauri-apps/api/*'` 与 `import '@tauri-apps/plugin-*'` 的层，
由 `eslint.config.js` 的 `no-restricted-imports` 规则机器强制（`src/ipc/**` 豁免）。

## 使用约定

- 业务代码调用 Rust command：经 `invoke.ts` 的类型化 `invoke()`；
  command 名与参数/返回值类型在 `src/types/ipc.ts` 的 `IpcCommands` 中登记。
- 窗口控制（最小化/最大化/关闭/显示/主题订阅）：经 `window.ts` 的 `windowControls`。

## 传输预算（硬规则）

**单次 JSON invoke 负载不得超过 1MiB；文件正文使用有界 Raw 分块。**

- 判定方法：对负载做序列化后字节数估算（`new TextEncoder().encode(JSON.stringify(payload)).length`，
  二进制负载按 `byteLength` 计）；估算值超过 1MB（1,048,576 字节）即触发红线。
- JSON 编码大正文会阻塞 webview 主线程并放大内存峰值；单次发送完整的大 Raw 正文也有同步传输成本。
  原生回传使用 `invokeStreamed` / Channel，前端上传使用下述逐块确认的写入会话。
- 文件读取入口 `readFile`、`readFileBytes`、`readImageBytes` 已统一经 `read_file_stream` 回传。
  兼容用的旧读取命令会拒绝实际 JSON 编码超过 1MiB 的结果。

## 文件读取协议

控制消息使用小 JSON；数据帧使用 Raw 字节，前 8 字节为小端文件偏移，正文块最大 256KiB。
Rust 的未确认窗口最大 1MiB，前端按已消费字节确认；两端各限制 4 个活跃读取。
调用方可传 `{ signal }` 取消，排队和读取共享 120 秒总期限，读取阶段 15 秒无进度即失败。
文本和阅读文件上限 100MiB，图片上限 25MiB；完整长度、顺序和文本 UTF-8 校验成功后才返回结果。

原生读取完成与编辑器排版是两个阶段。上述传输约束不能代替大文档解析、输入和渲染的实际测量。

## 文件写入协议

`writeFileAtomic`、`writeFileToPath`、`writeBytesToPath` 保留既有调用形状与失败语义，内部使用同一会话协议：

1. `begin_file_write` 接收小 JSON metadata：版本、会话 ID、目标、编码、完整字节长度及剩余总期限。
   中文路径保留在 JSON 中；路径守卫和另存为的绝对路径边界与既有写入一致。
2. `append_file_write` 每次只发送 1 至 256KiB 的 Raw 字节，通过 ASCII headers 传会话 ID 和字节偏移。
   前端等待当前块的原生确认后才发送下一块；原生拒绝超大块、错序、重复偏移和超出声明长度的数据。
3. `commit_file_write` 确认完整长度与 UTF-8，恢复既有 Unix mode、同步并关闭临时文件，再原子替换目标。
   只有真实落盘回执成功，调用方才能清除 dirty。空文件直接从 begin 进入 commit。
4. 失败时发送 `abort_file_write`；窗口销毁也取消所属会话。取消、空闲超时及总期限到达都会阻止后续发布，
   worker 关闭并删除本次拥有的临时文件。已经开始的原子发布以真实 rename 结果为准，不能提前报告取消成功。

前端和原生各限制 4 个活跃写入；排队、编码、传输共享前端 120 秒总期限，原生使用剩余期限且最多 120 秒，
15 秒无进度即终止。每个原生 worker 只有一个待处理消息槽位，文件内容顺序写入同目录临时文件。
操作系统尚未返回的 I/O 继续占有其槽位和临时文件；取消门禁止它在随后返回时继续提交。
legacy、单帧 Raw 与会话写入共用 `StagedWrite` 的权限、fsync、rename 和清理逻辑；应用保存入口使用会话写入。

这些边界保证传输和提交的行为，响应性仍需在真实 WebView 中测量编辑、自动保存和索引更新。

## 对应 Rust 侧形态

`invokeStreamed` 假定 Rust command 接收一个名为 `channel` 的 `tauri::ipc::Channel<T>` 参数，
分块调用 `channel.send(chunk)` 回传，最终返回值经 `Result` 正常返回。
