/**
 * 占位封面（FEAT-SHELF）：非 epub（txt/docx/pdf）无内嵌封面 → 生成主题色调的标题卡 SVG data: URI。
 * 颜色在生成时用 getComputedStyle 取 theme.css token 解析为具体值注入——SVG 是独立文档、解析不到 var(--...)，
 * 故 gen-time 解析既保主题正确、又不在源码里硬编码颜色（同 readingPresets standalone-doc 取向）。
 */
function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 标题按每行 perLine 字断行，最多 maxLines 行，溢出末行省略号。 */
function wrapTitle(title: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  let rest = title.trim();
  while (rest && lines.length < maxLines) {
    lines.push(rest.slice(0, perLine));
    rest = rest.slice(perLine);
  }
  if (rest && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, perLine - 1)}…`;
  return lines.length ? lines : ['未命名'];
}

export function placeholderCover(title: string, format: string): string {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  const surface = v('--background-secondary', '#1e2228');
  const surface2 = v('--background-primary', '#15181c');
  const text = v('--text-normal', '#e8e8e8');
  const muted = v('--text-muted', '#9aa0a8');
  const accentHsl = cs.getPropertyValue('--accent-hsl').trim();
  const accent = accentHsl ? `hsl(${accentHsl})` : '#3b8774';
  const lines = wrapTitle(title, 8, 4);
  const startY = 200 - (lines.length - 1) * 17;
  const tspans = lines.map((l, i) => `<tspan x="150" dy="${i === 0 ? 0 : 34}">${escXml(l)}</tspan>`).join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">` +
    `<rect width="300" height="400" fill="${surface}"/>` +
    `<rect width="300" height="60" fill="${surface2}"/>` +
    `<rect x="0" y="0" width="5" height="400" fill="${accent}"/>` +
    `<text x="150" y="${startY}" text-anchor="middle" fill="${text}" font-family="-apple-system,sans-serif" font-size="26" font-weight="650">${tspans}</text>` +
    `<text x="150" y="372" text-anchor="middle" fill="${muted}" font-family="-apple-system,sans-serif" font-size="12" letter-spacing="3">${escXml(format.toUpperCase())}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
