import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    rolldownOptions: {
      // codemirror-lang-typst 内部 `import * as wasm from "*.wasm"`（wasm-bindgen ESM）
      // Vite 8 Rolldown 生产构建不支持（builtin:vite-wasm-fallback 直接抛错）。临时 external：
      // 运行时动态 import 失败由 loadTypst 的 catch 兜底（typst 文档回退纯文本高亮）。
      // Phase 5 接入 typst.ts wasm（?url + 显式 init）时一并正解并撤此 external。
      external: ['codemirror-lang-typst'],
    },
  },
});
