import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url';
import { typstFontUrls } from '../livepreview/typst/typstAssets';
import type { EquationPdfRequest, EquationPdfResult } from './equationPdfMessages';

const TIMEOUT_MS = 45_000;

export function equationPdfAbortError(): Error {
  const error = new Error('公式 PDF 导出已取消');
  error.name = 'AbortError';
  return error;
}

/** 导出拥有独立 Worker；文档预览暂停、重编译或清空不会误取消已经提交的 PDF 工作。 */
export function compileSvgToPdf(
  svg: string,
  options: { widthPt: number; heightPt: number; signal: AbortSignal },
): Promise<Uint8Array> {
  if (options.signal.aborted) return Promise.reject(equationPdfAbortError());
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (result: Uint8Array | Error): void => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      options.signal.removeEventListener('abort', abort);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const abort = (): void => finish(equationPdfAbortError());
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      worker = new Worker(new URL('./equationPdfWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<EquationPdfResult>) => {
        const message = event.data;
        if (message?.type !== 'pdf-result') return;
        if (!message.ok) { finish(new Error(message.error || '公式 PDF 编译失败')); return; }
        const received = message.pdf;
        // TypedArray 可能由另一 realm 的传输适配器创建，不能以当前 realm 的构造器 instanceof 拒绝真实字节。
        if (!ArrayBuffer.isView(received) || Object.prototype.toString.call(received) !== '[object Uint8Array]' || received.byteLength < 16) {
          finish(new Error('公式 PDF 输出为空或无效'));
          return;
        }
        const pdf = new Uint8Array(received);
        const decoder = new TextDecoder('ascii');
        if (!decoder.decode(pdf.subarray(0, 8)).startsWith('%PDF-') || !decoder.decode(pdf.subarray(-1024)).includes('%%EOF')) {
          finish(new Error('公式 PDF 输出无效'));
          return;
        }
        finish(pdf);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(new Error(event.message || '公式 PDF Worker 运行失败'));
      };
      worker.onmessageerror = () => finish(new Error('公式 PDF Worker 返回的数据无法读取'));
      timeout = setTimeout(() => finish(new Error('公式 PDF 编译超时，请重试')), TIMEOUT_MS);
      const request: EquationPdfRequest = {
        type: 'export-svg-pdf', svg, widthPt: options.widthPt, heightPt: options.heightPt,
        compilerWasmUrl, fontUrls: typstFontUrls(),
      };
      worker.postMessage(request);
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
