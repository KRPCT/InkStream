import { $typst } from '@myriaddreamin/typst.ts';

/**
 * typst 编译 Worker（Phase 5 W3 / BLOCK-02）：在 Worker 线程内用 typst.ts（wasm）把 ```typst 源编译成 SVG 字符串。
 * 主线程经 postMessage 发 {type:'compile', id, source}，Worker 回 {type:'result', id, ok, svg|error}。
 *
 * wasm（compiler + renderer，合计约 10-20MB）经 getModule:()=>fetch(同源 wasmUrl) 拉取并实例化——wasmUrl 由
 * 主线程首条 {type:'init', ...} 传入（Vite ?url 产出的同源 URL）。CSP：wasm 实例化由 script-src 'wasm-unsafe-eval'
 * 放行，同源 fetch 由 connect-src('self' 回退) 放行。
 *
 * 并发：$typst 单例不支持并发编译，故本 Worker 串行处理（chain）。主线程负责防抖 + 丢弃过期请求，Worker 只忠实串行执行。
 */

interface InitMsg {
  type: 'init';
  compilerWasmUrl: string;
  rendererWasmUrl: string;
}
interface CompileMsg {
  type: 'compile';
  id: number;
  source: string;
}
type InMsg = InitMsg | CompileMsg;

interface OutMsg {
  type: 'ready' | 'result';
  id?: number;
  ok?: boolean;
  svg?: string;
  error?: string;
}

const post = (msg: OutMsg): void => (self as unknown as { postMessage(m: OutMsg): void }).postMessage(msg);

/** page 前置：按内容裁剪尺寸（非默认 A4 整页），少量内边距——预览紧贴内容、无大片空白页（§6.8）。 */
const TYPST_PAGE_PREAMBLE = '#set page(width: auto, height: auto, margin: 8pt)\n';

let inited = false;
// 串行闸：保证 $typst.svg 一次只跑一个（单例不并发）。
let chain: Promise<void> = Promise.resolve();

self.addEventListener('message', (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    if (inited) return;
    inited = true;
    $typst.setCompilerInitOptions({ getModule: () => fetch(msg.compilerWasmUrl) });
    $typst.setRendererInitOptions({ getModule: () => fetch(msg.rendererWasmUrl) });
    post({ type: 'ready' }); // wasm 在首个 svg() 时惰性 init。
    return;
  }
  const { id, source } = msg;
  chain = chain.then(async () => {
    try {
      // 前置 page 设置：让 typst 按内容裁剪尺寸（而非默认 A4 整页，避免大片空白），margin 留少量内边距。
      const svg = await $typst.svg({ mainContent: TYPST_PAGE_PREAMBLE + source });
      post({ type: 'result', id, ok: true, svg });
    } catch (err) {
      post({ type: 'result', id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
});
