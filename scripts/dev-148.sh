#!/usr/bin/env bash
# InkStream dev：pin WebView2 148 Fixed Runtime（绕 Chromium 149 中文 IME 吞字回归）+ 开 CDP 9222 + ucrt64 PATH。
# 见记忆 inkstream-ime-webview2-rootcause：149 回归致吞字，148 原生 CM6 中文稳定。务必用本脚本启 dev。
export WEBVIEW2_BROWSER_EXECUTABLE_FOLDER="D:/Github/_refs/webview2-fixed/148.0.3967.96.x64/Microsoft.WebView2.FixedVersionRuntime.148.0.3967.96.x64"
export WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
export PATH="/c/msys64/ucrt64/bin:$PATH"
exec pnpm tauri dev
