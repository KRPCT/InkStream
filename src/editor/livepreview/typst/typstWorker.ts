import { createTypstCompiler, createTypstRenderer, loadFonts, type BeforeBuildFn } from '@myriaddreamin/typst.ts';
import type { TypstWorkerInput, TypstWorkerOutput } from './typstMessages';

const port = self as unknown as { postMessage(message: TypstWorkerOutput): void };
const post = (message: TypstWorkerOutput): void => port.postMessage(message);
const compiler = createTypstCompiler();
const renderer = createTypstRenderer();
const cancelled = new Set<number>();
let completed = 0;
let initialized: Promise<void> | null = null;
let chain: Promise<void> = Promise.resolve();
const PREAMBLE = '#set page(width: auto, height: auto, margin: 8pt)\n#set text(font: ("Libertinus Serif", "Noto Serif CJK SC"))\n';

async function sameOriginResponse(url: string): Promise<Response> {
  const resolved = new URL(url, self.location.href);
  if (resolved.origin !== self.location.origin) throw new Error('Typst 资源必须来自应用本地');
  const response = await fetch(resolved, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Typst 资源读取失败（${response.status}）：${resolved.pathname}`);
  return response;
}

async function initialize(message: Extract<TypstWorkerInput, { type: 'init' }>): Promise<void> {
  const fonts = await Promise.all(message.fontUrls.map(async (url) => new Uint8Array(await (await sameOriginResponse(url)).arrayBuffer())));
  // 0.7.0 默认 loader 创建 JS Function，违反桌面 CSP。保留其字体配置标记，使用公开 builder 钩子装入已取回的字节。
  const addLocalFonts: BeforeBuildFn = Object.assign(async (_stage: Parameters<BeforeBuildFn>[0], context: { builder: { add_raw_font(bytes: Uint8Array): Promise<void> } }) => {
    for (const font of fonts) await context.builder.add_raw_font(font);
  }, loadFonts([], { assets: false }));
  await compiler.init({ getModule: () => sameOriginResponse(message.compilerWasmUrl), beforeBuild: [addLocalFonts] });
  await renderer.init({ getModule: () => sameOriginResponse(message.rendererWasmUrl) });
  post({ type: 'ready' });
}

self.addEventListener('message', (event: MessageEvent<TypstWorkerInput>) => {
  const message = event.data;
  if (message.type === 'init') {
    if (!initialized) {
      initialized = initialize(message);
      void initialized.catch((error: unknown) => post({ type: 'init-error', error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  if (message.type === 'cancel') {
    if (message.id > completed) cancelled.add(message.id);
    return;
  }
  chain = chain.then(async () => {
    try {
      if (!initialized) throw new Error('Typst 尚未初始化');
      await initialized;
      if (cancelled.has(message.id)) return;
      await compiler.reset();
      compiler.addSource('/preview.typ', PREAMBLE + message.source);
      // 0.7.0 compile() 不释放临时 world；runWithWorld 会释放。回调内收口异常，确保也经过其释放路径。
      const compiled = await compiler.runWithWorld({ mainFilePath: '/preview.typ', inputs: {} }, async (world) => {
        try { return { ok: true as const, result: await world.vector({ diagnostics: 'unix' }) }; }
        catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : String(error) }; }
      });
      if (!compiled.ok) throw new Error(compiled.error);
      const result = compiled.result;
      const vector = result.result;
      if (!vector) throw new Error(result.diagnostics?.join('\n') || 'Typst 未生成编译结果');
      const svg = await renderer.runWithSession(async (session) => {
        renderer.manipulateData({ renderSession: session, action: 'reset', data: vector });
        return renderer.renderSvg({ renderSession: session });
      });
      if (!cancelled.has(message.id)) post({ type: 'result', id: message.id, ok: true, svg });
    } catch (error) {
      if (!cancelled.has(message.id)) post({ type: 'result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      completed = Math.max(completed, message.id);
      cancelled.delete(message.id);
    }
  });
});
