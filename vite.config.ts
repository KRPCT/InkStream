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
  optimizeDeps: {
    // typst.ts JS glue 模块多，dev 预构建避免首个 typst 块编译前现场 pre-bundle 卡顿（Phase 5 W3）。
    include: ['@myriaddreamin/typst.ts'],
    // 两个 wasm 包不可被 esbuild pre-bundle（会破 `?url` 资源语义）——wasm 经 ?url import 当同源资源处理。
    exclude: ['@myriaddreamin/typst-ts-web-compiler', '@myriaddreamin/typst-ts-renderer'],
  },
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
