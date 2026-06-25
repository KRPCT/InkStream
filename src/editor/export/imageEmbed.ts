import { readImageBytes } from '../../ipc/files';
import {
  type ImageVaultContext,
  resolveVaultImage,
} from '../livepreview/widgets/ImageWidget';
import { collectImageUrls } from './markdownToHtml';

/**
 * 导出图片内嵌（FEAT-EXPORT 图片）：把文档引用的 vault 内本地图读成 data URI，内嵌进导出产物，
 * 使 HTML / PDF / DOCX 脱离 vault 仍能显示图片（修「导出无法嵌入图片」）。
 *
 * 安全边界（复用编辑器实景）：本地图解析严格走 ImageWidget.resolveVaultImage——只内嵌「相对路径且落在
 * vault 根内」的图，越界/绝对/带 scheme 一律不读（承 T-03-19 path_guard 纪律）；Rust read_image_bytes 再以
 * 图片扩展名白名单兜底。远程 http(s) 不抓取（保活链接，避网络失败/超时/隐私面）；markdown 里已是 data: 的图
 * 已内嵌、跳过。所见即所得：编辑器能渲染的本地图，导出即内嵌。
 */

/** 图片扩展名 → MIME（内嵌 data URI 用；未列入的扩展名不内嵌）。 */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
};

/** url/路径末段扩展名（小写，剥查询/锚点）；无扩展名返空。 */
function extOf(url: string): string {
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}

/** 末段扩展名 → MIME；未知扩展名返 null（不内嵌）。 */
export function mimeForUrl(url: string): string | null {
  return MIME_BY_EXT[extOf(url)] ?? null;
}

/** 二进制 → base64 data URI（分块 fromCharCode，避超大数组 spread 爆栈）。 */
export function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * 预解析文档内本地图为 data URI 映射（键 = 原始 url，与 markdownToHtml 渲染分支一致）。
 * 逐图并行解析；单张失败（越界/读不到/超限/非图片）静默跳过，绝不阻断其余图片与整篇导出。
 */
export async function resolveExportImages(
  markdown: string,
  vault: ImageVaultContext | null,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    collectImageUrls(markdown).map(async (raw) => {
      const resolved = resolveVaultImage(raw, vault);
      if (resolved.kind !== 'local') return; // 远程保活链接 / data: 已内嵌 / invalid 越界——均不读盘
      const mime = mimeForUrl(raw);
      if (!mime) return;
      try {
        map.set(raw, bytesToDataUri(await readImageBytes(resolved.absPath), mime));
      } catch {
        // 单图失败不阻断整篇导出（渲染分支自动回落 safeSrc）。
      }
    }),
  );
  return map;
}

/** DOCX 内嵌图：解码出的 PNG 字节 + 原始像素尺寸。 */
export interface EmbeddedPng {
  data: Uint8Array;
  width: number;
  height: number;
}

/** 按最大宽度等比缩放（DOCX 内嵌图不溢出版心；尺寸异常回退到 maxW 方图）。 */
export function scaleToFit(w: number, h: number, maxW: number): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: maxW, height: maxW };
  if (w <= maxW) return { width: Math.round(w), height: Math.round(h) };
  return { width: maxW, height: Math.max(1, Math.round((h * maxW) / w)) };
}

/** data URI 经 <img> 加载（onload/onerror）。 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

/**
 * 浏览器解码 data URI → PNG 字节 + 原始尺寸（canvas 统一转 PNG，webp/svg/avif 等一并归一为 docx 可嵌格式）。
 * 解码失败 / 无 canvas（jsdom）/ 尺寸为 0（无固有尺寸的 svg）→ null（DOCX 侧回落占位文本，不破坏文档）。
 *
 * 先探测 2d context：jsdom 下 getContext 返 null，提前返回——避免 `new Image()` 在 jsdom 永不触发
 * load/error 而挂死（DOCX 单测据此走占位回落分支，不超时）。
 */
export async function dataUriToPng(dataUri: string): Promise<EmbeddedPng | null> {
  const canvas = document.createElement('canvas');
  const cx = canvas.getContext('2d');
  if (!cx) return null;
  try {
    const img = await loadImage(dataUri);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return null;
    canvas.width = width;
    canvas.height = height;
    cx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return null;
    return { data: new Uint8Array(await blob.arrayBuffer()), width, height };
  } catch {
    return null;
  }
}
