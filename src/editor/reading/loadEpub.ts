import type JSZipType from 'jszip';

/**
 * 最小 EPUB 解析（FEAT-READ）：复用 docx 已带的 jszip（不引 foliate-js / epubjs——维护者变更 / 陈旧风险）。
 * 流程：解 zip → META-INF/container.xml 取 OPF → OPF 取 manifest(含 media-type) + spine 顺序 → 逐 XHTML 取 <body>、
 * 内嵌图片重写为 data: URI（MIME 优先取 manifest 声明，回退扩展名）、剥 <script>，按 spine 拼接。XHTML 经 DOMParser
 * 解析；产物在无 allow-scripts 的 sandbox iframe 渲染（脚本不执行）。
 * 资源防护：限 spine 条数 + 累计正文字节（防超长 spine / zip-bomb 撑爆主线程）。路径解析仅作用于 zip 内命名空间
 * （zip.file() 不触文件系统，`../` 至多解析到不存在的 zip 键，无穿越风险）。
 */

const XML = 'application/xml';
const HTML = 'text/html';
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
};
const MAX_SPINE = 2000;
const MAX_HTML_BYTES = 60 * 1024 * 1024;

async function readText(zip: JSZipType, path: string): Promise<string> {
  const f = zip.file(path);
  return f ? f.async('string') : '';
}

/** 把 rel（相对 base 文件所在目录）解析为 zip 内归一路径（仅 zip 命名空间，无 fs）。 */
function resolvePath(base: string, rel: string): string {
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  const out: string[] = [];
  for (const p of (dir + rel.replace(/^\//, '')).split('/')) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

export async function loadEpub(bytes: Uint8Array): Promise<{ html: string; text: string }> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();

  const container = parser.parseFromString(await readText(zip, 'META-INF/container.xml'), XML);
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) return { html: '<p>无法解析此 EPUB（缺少 OPF）。</p>', text: '' };

  const opf = parser.parseFromString(await readText(zip, opfPath), XML);
  const manifest = new Map<string, string>();
  const mediaByPath = new Map<string, string>();
  opf.querySelectorAll('manifest > item').forEach((it) => {
    const id = it.getAttribute('id');
    const href = it.getAttribute('href');
    const type = it.getAttribute('media-type');
    if (!id || !href) return;
    manifest.set(id, href);
    if (type) mediaByPath.set(resolvePath(opfPath, href), type);
  });
  const spine = Array.from(opf.querySelectorAll('spine > itemref'))
    .map((ir) => ir.getAttribute('idref'))
    .map((id) => (id ? manifest.get(id) : undefined))
    .filter((x): x is string => Boolean(x))
    .slice(0, MAX_SPINE);

  let html = '';
  let text = '';
  let truncated = false;
  for (const href of spine) {
    if (html.length > MAX_HTML_BYTES) {
      truncated = true;
      break;
    }
    const path = resolvePath(opfPath, href);
    const doc = parser.parseFromString(await readText(zip, path), HTML);
    doc.querySelectorAll('script').forEach((s) => s.remove());
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) continue;
      const imgPath = resolvePath(path, src.split(/[?#]/)[0]);
      const file = zip.file(imgPath);
      if (!file) {
        img.remove();
        continue;
      }
      const type = mediaByPath.get(imgPath) ?? MIME[imgPath.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/png';
      img.setAttribute('src', `data:${type};base64,${await file.async('base64')}`);
    }
    html += `<section>${doc.body?.innerHTML ?? ''}</section>`;
    text += `${doc.body?.textContent ?? ''}\n`;
  }
  if (truncated) html += '<p style="opacity:.6">（文档过大，仅显示前部分）</p>';
  return { html, text };
}
