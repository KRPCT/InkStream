function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, '\\$1');
}

function emphasis(text: string, mark: string): string {
  const leading = /^\s*/.exec(text)![0];
  const trailing = /\s*$/.exec(text)![0];
  const inner = text.trim();
  return inner ? `${leading}${mark}${inner}${mark}${trailing}` : text;
}

function scriptText(text: string, position: 'sup' | 'sub'): string {
  const normal = '0123456789+-=()';
  const scripts = position === 'sup' ? '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾' : '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎';
  if ([...text].every((character) => normal.includes(character))) {
    return [...text].map((character) => scripts[normal.indexOf(character)]).join('');
  }
  const escaped = text.replace(/([\\{}%$#&_])/g, '\\$1');
  return `$${position === 'sup' ? '^' : '_'}{\\text{${escaped}}}$`;
}

/** Convert only presentation markup; CSL alone owns names, dates, labels and sorting. */
export function bibliographyHtmlToMarkdown(html: string, omitNumber = false): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const entry = template.content.querySelector('.csl-entry') ?? template.content;
  if (omitNumber) entry.querySelector('.csl-left-margin')?.remove();
  const visit = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '');
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return [...node.childNodes].map(visit).join('');
    if (!(node instanceof Element)) return '';
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'img'].includes(tag)) return '';
    const text = [...node.childNodes].map(visit).join('');
    if (tag === 'i' || tag === 'em') return emphasis(text, '*');
    if (tag === 'b' || tag === 'strong') return emphasis(text, '**');
    if (tag === 'sup' || tag === 'sub') return scriptText(node.textContent ?? '', tag);
    if (tag === 'br') return '\n';
    if (tag === 'a') {
      const href = node.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(href)) return text;
      const target = href.replace(/[()[\]\\\s<>`]/g, (character) =>
        character === '(' ? '%28' : character === ')' ? '%29' : encodeURIComponent(character),
      );
      return `[${text}](${target})`;
    }
    if (node.classList.contains('csl-left-margin')) return `${text.trim()} `;
    if (node.classList.contains('csl-block')) return `${text}\n`;
    return text;
  };
  return visit(entry).replace(/\u00a0/g, ' ').trim().replace(/^(\d+)\. /, '$1\\. ');
}
