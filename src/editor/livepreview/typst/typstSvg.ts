function unsafeCss(value: string): boolean {
  if (/@import|\\/i.test(value)) return true;
  return [...value.matchAll(/url\s*\(([^)]*)\)/gi)].some((match) => !match[1].trim().replace(/^['"]|['"]$/g, '').startsWith('#'));
}

let svgSequence = 0;

function isolateIds(svg: SVGSVGElement): void {
  const prefix = `ink-typst-${++svgSequence}-`;
  const identifiers = new Map<string, string>();
  for (const node of [svg, ...svg.querySelectorAll('[id]')]) {
    const id = node.getAttribute('id');
    if (id) { identifiers.set(id, prefix + id); node.setAttribute('id', prefix + id); }
  }
  const urls = (value: string): string => value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (original, quote: string, id: string) => {
    const next = identifiers.get(id);
    return next ? `url(${quote}#${next}${quote})` : original;
  });
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      if ((attribute.name === 'href' || attribute.name === 'xlink:href') && attribute.value.startsWith('#')) {
        const next = identifiers.get(attribute.value.slice(1));
        if (next) node.setAttribute(attribute.name, '#' + next);
        else node.removeAttribute(attribute.name);
      } else if (attribute.value.includes('url(')) node.setAttribute(attribute.name, urls(attribute.value));
    }
  }
  for (const style of svg.querySelectorAll('style')) style.textContent = urls(style.textContent ?? '');
}

/** 两处预览共用 SVG 解析；不让文献中的链接或外部资源在预览中执行。 */
export function typstSvgElement(source: string): SVGSVGElement | null {
  const svg = new DOMParser().parseFromString(source, 'text/html').querySelector('svg');
  if (!svg) return null;
  for (const node of svg.querySelectorAll('script, foreignObject, iframe, object, embed')) node.remove();
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on')) node.removeAttribute(attribute.name);
      else if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#') && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value)) node.removeAttribute(attribute.name);
      else if ((name === 'style' || /^(?:fill|stroke|filter|clip-path|mask|marker-start|marker-mid|marker-end)$/.test(name)) && unsafeCss(value)) node.removeAttribute(attribute.name);
    }
  }
  for (const style of svg.querySelectorAll('style')) {
    if (unsafeCss(style.textContent ?? '')) style.remove();
  }
  isolateIds(svg);
  return document.importNode(svg, true);
}
