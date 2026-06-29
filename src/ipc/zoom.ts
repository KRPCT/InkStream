import { getCurrentWebview } from '@tauri-apps/api/webview';

/**
 * 整体界面缩放（v1.2.1）：调 webview 原生缩放（等价浏览器 Ctrl+/−），均匀缩放标题栏 / 侧栏 /
 * 编辑器 / 面板 / 终端 / 图谱。选它而非 CSS zoom/transform：是真·浏览器缩放，CM6 的
 * coordsAtPos/posAtCoords 命中测试完全支持，不破坏编辑器坐标系（CSS transform 会破 fixed 模态与命中测试）。
 *
 * 不跨重载持久（webview 缩放是会话态）——故由 persistSettings 启动时以盘上 uiZoom 重放（同 editorFontSize 纪律）。
 * 非 Tauri 运行时（单测 / 纯浏览器 dev）静默 no-op。
 */
export async function setWebviewZoom(scale: number): Promise<void> {
  try {
    await getCurrentWebview().setZoom(scale);
  } catch {
    /* 非 Tauri runtime / 缩放被拒：忽略，不影响内存态 uiZoom */
  }
}
