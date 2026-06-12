import { open } from '@tauri-apps/plugin-dialog';

/**
 * 原生系统对话框前端通道（R4 §2）。全项目唯一接触 @tauri-apps/plugin-dialog 的文件
 * （ipc/ 收口立约）：业务代码经此调用，不直接 import @tauri-apps/*。
 *
 * 权限面：capability 仅授 `dialog:allow-open`（最小权限）——故本层只暴露「打开」族，
 * 不提供 save（另存为本阶段不做）。原生对话框返回的路径仍交 Rust 端 vault/files command
 * 的 path_guard 收口校验，不削弱现有路径防护。
 */

/** 仅 Markdown / 纯文本文件过滤（打开文件用；无 `.` 前缀，跨平台 OS 原生过滤器）。 */
const MARKDOWN_FILTER = {
  name: 'Markdown',
  extensions: ['md', 'markdown', 'txt'],
};

/**
 * 打开目录选择对话框（资源管理器风格）。取消返回 null。
 * `multiple: false` 保证返回单一字符串（OpenDialogReturn 收窄为 `string | null`）。
 */
export function pickFolder(): Promise<string | null> {
  return open({ directory: true, multiple: false });
}

/**
 * 打开文件选择对话框，过滤 Markdown / 纯文本。取消返回 null。
 * `directory: false` + `multiple: false` 返回单一文件绝对路径。
 */
export function pickFile(): Promise<string | null> {
  return open({ directory: false, multiple: false, filters: [MARKDOWN_FILTER] });
}
