import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** 只适配 codemirror-lang-typst@0.4.0 的 bundler wrapper，保留上游 parser/glue/WASM 原文件。 */
function typstSyntaxWasm(): Plugin {
  const entry = createRequire(import.meta.url).resolve('codemirror-lang-typst');
  const asset = (name: string) => resolve(dirname(entry), '../wasm', name).replaceAll('\\', '/');
  const glue = JSON.stringify(asset('typst_syntax_bg.js'));
  const wasm = JSON.stringify(asset('typst_syntax_bg.wasm') + '?init');
  const id = '\0inkstream:typst-syntax-wasm';
  return {
    name: 'inkstream-typst-syntax-wasm',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../wasm/typst_syntax.js' && importer?.replaceAll('\\', '/').split('?')[0].endsWith('/codemirror-lang-typst/dist/index.js')) return id;
      return null;
    },
    load(request) {
      if (request !== id) return null;
      return `import init from ${wasm};\nimport * as glue from ${glue};\nexport * from ${glue};\nconst instance = await init({ "./typst_syntax_bg.js": glue });\nglue.__wbg_set_wasm(instance.exports);\ninstance.exports.__wbindgen_start();\n`;
    },
  };
}

export default defineConfig({
  plugins: [typstSyntaxWasm(), react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  optimizeDeps: {
    // typst.ts JS glue 模块多，dev 预构建避免首个 typst 块编译前现场 pre-bundle 卡顿（Phase 5 W3）。
    include: ['@myriaddreamin/typst.ts'],
    // WASM 保留 ?url / ?init 资源语义；Typst 语法包经上面的窄适配处理。
    exclude: ['@myriaddreamin/typst-ts-web-compiler', '@myriaddreamin/typst-ts-renderer', 'codemirror-lang-typst'],
  },
});
