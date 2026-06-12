//! WebView2 IME 内部输入焦点武装通道（EDIT-06 真因修复）。
//!
//! 背景（CDP 实测）：程序化 DOM `view.focus()` 与合成（isTrusted=false）指针事件**都不**
//! 武装 WebView2 的内部输入焦点 / Windows TSF text store，故打开文件后首次中文组合不触发
//! compositionstart——整段文本丢失，只有用户真实点击编辑器后才恢复。微软对此的既定解法是
//! 从原生侧调用 `ICoreWebView2Controller::MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)`：
//! 它建立 IME 所需的内部输入焦点 + TSF，与 DOM 焦点解耦。
//!
//! 实现：经 Tauri `WebviewWindow::with_webview` 拿到 `PlatformWebview`，Windows 下其
//! `controller()` 返回 `webview2_com::...::ICoreWebView2Controller`，对其调用 `MoveFocus(Programmatic)`。
//!
//! 纪律：
//!   - Windows 专属代码以 `#[cfg(target_os = "windows")]` 门控；其它平台命令为 no-op，保持跨平台可编译。
//!   - `MoveFocus` 是 `unsafe` 且返回 `HRESULT`：忽略/记录错误，绝不 panic、绝不阻塞输入。
//!   - `with_webview` 回调需 `Send + 'static`，且在主线程执行——命令体内直接派发即可。

use tauri::WebviewWindow;

/// 武装 WebView2 内部输入焦点 / TSF，使打开文件后首次 IME 组合直接落到编辑器（EDIT-06）。
///
/// 前端在 `focusEditor` 的 DOM `view.focus()` 之后 fire-and-forget 调用本命令。
/// 任一环节失败只回 `Err(String)` 供前端 catch 吞掉——绝不让 IME 武装拖垮打开流程。
#[tauri::command]
pub fn arm_webview_ime(window: WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        window
            .with_webview(|platform_webview| {
                use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC;
                // controller() 返回 ICoreWebView2Controller（webview2-com 类型）。
                // MoveFocus 为 unsafe + 返回 windows_core::Result<()>：忽略错误，绝不 panic。
                let controller = platform_webview.controller();
                unsafe {
                    if let Err(e) = controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC) {
                        eprintln!("[IME-TRACE] arm_webview_ime MoveFocus 失败: {e:?}");
                    }
                }
            })
            .map_err(|e| format!("arm_webview_ime with_webview 失败: {e}"))?;
    }
    // 非 Windows：no-op（保持跨平台可编译，IME 武装为 Windows/WebView2 专属问题）。
    #[cfg(not(target_os = "windows"))]
    let _ = &window;
    Ok(())
}
