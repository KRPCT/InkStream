import { createTypstCompiler, loadFonts, type BeforeBuildFn } from '@myriaddreamin/typst.ts';
import type { EquationPdfRequest, EquationPdfResult } from './equationPdfMessages';

const port = self as unknown as { postMessage(message: EquationPdfResult, transfer?: Transferable[]): void };

async function localResponse(url: string): Promise<Response> {
  const resolved = new URL(url, self.location.href);
  if (resolved.origin !== self.location.origin) throw new Error('公式 PDF 资源必须来自应用本地');
  const response = await fetch(resolved, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`公式 PDF 资源读取失败（${response.status}）：${resolved.pathname}`);
  return response;
}

async function compile(message: EquationPdfRequest): Promise<Uint8Array<ArrayBuffer>> {
  const { widthPt, heightPt } = message;
  if (![widthPt, heightPt].every((size) => Number.isFinite(size) && size > 0)) throw new Error('公式 SVG 尺寸无效');
  const compiler = createTypstCompiler();
  const fonts = await Promise.all(message.fontUrls.map(async (url) => new Uint8Array(await (await localResponse(url)).arrayBuffer())));
  // 与预览相同的公开 builder 钩子：不调用默认 CDN/Function 字体 loader，遵守桌面 CSP。
  const addLocalFonts: BeforeBuildFn = Object.assign(async (_stage: Parameters<BeforeBuildFn>[0], context: { builder: { add_raw_font(bytes: Uint8Array): Promise<void> } }) => {
    for (const font of fonts) await context.builder.add_raw_font(font);
  }, loadFonts([], { assets: false }));
  await compiler.init({ getModule: () => localResponse(message.compilerWasmUrl), beforeBuild: [addLocalFonts] });
  const path = '/formula.svg';
  compiler.mapShadow(path, new TextEncoder().encode(message.svg));
  try {
    // 固定为片段宽高加 8pt 页边距，绝不让段落基线或默认 A4 多出空白页。
    const source = `#set page(width: ${widthPt + 16}pt, height: ${heightPt + 16}pt, margin: 8pt)\n#place(top + left, image("${path}", width: ${widthPt}pt, height: ${heightPt}pt))\n`;
    compiler.addSource('/formula.typ', source);
    const compiled = await compiler.runWithWorld({ mainFilePath: '/formula.typ', inputs: {} }, async (world) => {
      // typst.ts 0.7.0 的 runWithWorld 只在回调正常返回后释放 world，因此在回调内收口编译错误。
      try { return { ok: true as const, result: await world.pdf({ diagnostics: 'unix' }) }; }
      catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : String(error) }; }
    });
    if (!compiled.ok) throw new Error(compiled.error);
    if (!compiled.result.result) throw new Error(compiled.result.diagnostics?.join('\n') || '公式 PDF 编译未生成结果');
    return new Uint8Array(compiled.result.result);
  } finally { compiler.unmapShadow(path); }
}

let started = false;
self.addEventListener('message', (event: MessageEvent<EquationPdfRequest>) => {
  if (started || event.data?.type !== 'export-svg-pdf') return;
  started = true;
  void compile(event.data).then(
    (pdf) => port.postMessage({ type: 'pdf-result', ok: true, pdf }, [pdf.buffer]),
    (error: unknown) => port.postMessage({ type: 'pdf-result', ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
});
