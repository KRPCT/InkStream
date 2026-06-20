import type JSZipType from 'jszip';
import { readFileBytes } from '../ipc/files';

/**
 * EPUB 封面提取（FEAT-SHELF）：复用 loadEpub 同款 jszip + OPF 解析（不引新依赖）。
 * 解析优先级：EPUB2 `<meta name="cover">` → EPUB3 `properties="cover-image"` → 文件名含 cover 的图 → 首张图。
 * 取到则编码为 data: URI（CSP img-src 允许 data:），取不到返回 undefined（交占位封面）。封面体积封顶，跳过纯 SVG。
 */
const IMG_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};
const COVER_MAX_BYTES = 1.5 * 1024 * 1024;

async function readText(zip: JSZipType, path: string): Promise<string> {
  const f = zip.file(path);
  return f ? f.async('string') : '';
}

/** 把 rel 解析为 zip 内归一路径（仅 zip 命名空间，无 fs，同 loadEpub）。 */
function resolvePath(base: string, rel: string): string {
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  const out: string[] = [];
  for (const p of (dir + rel.replace(/^\//, '')).split('/')) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

interface ManifestItem {
  id: string;
  href: string;
  type: string;
  props: string;
}

export async function extractEpubCover(absPath: string): Promise<string | undefined> {
  try {
    const bytes = await readFileBytes(absPath);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    const parser = new DOMParser();

    const container = parser.parseFromString(await readText(zip, 'META-INF/container.xml'), 'application/xml');
    const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
    if (!opfPath) return undefined;
    const opf = parser.parseFromString(await readText(zip, opfPath), 'application/xml');

    const items: ManifestItem[] = [];
    opf.querySelectorAll('manifest > item').forEach((it) => {
      const id = it.getAttribute('id');
      const href = it.getAttribute('href');
      if (id && href) {
        items.push({ id, href, type: it.getAttribute('media-type') ?? '', props: it.getAttribute('properties') ?? '' });
      }
    });
    const metaCoverId = opf.querySelector('metadata > meta[name="cover"]')?.getAttribute('content');
    const isImg = (i: ManifestItem): boolean => /^image\//.test(i.type) || /\.(jpe?g|png|gif|webp|svg)$/i.test(i.href);
    const cover =
      (metaCoverId ? items.find((i) => i.id === metaCoverId) : undefined) ??
      items.find((i) => i.props.split(/\s+/).includes('cover-image')) ??
      items.find((i) => isImg(i) && /cover\.(jpe?g|png|gif|webp)$/i.test(i.href)) ??
      items.find(isImg);
    if (!cover) return undefined;

    const path = resolvePath(opfPath, cover.href);
    const file = zip.file(path);
    if (!file) return undefined;
    const mime = cover.type || IMG_MIME[path.split('.').pop()?.toLowerCase() ?? ''] || 'image/jpeg';
    // 跳过 SVG 封面：按 href 扩展名 + MIME 双判（manifest 缺 media-type 时 mime 会错回退成 jpeg，仅按 MIME 漏判）。
    if (/\.svg$/i.test(path) || mime === 'image/svg+xml') return undefined;
    const data = await file.async('uint8array');
    if (data.length > COVER_MAX_BYTES) return undefined;
    return `data:${mime};base64,${await file.async('base64')}`;
  } catch {
    return undefined;
  }
}
