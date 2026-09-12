const FONT_NAMES = [
  'LibertinusSerif-Regular.otf',
  'LibertinusSerif-Bold.otf',
  'LibertinusSerif-Italic.otf',
  'LibertinusSerif-BoldItalic.otf',
  'NewCMMath-Regular.otf',
  'NewCMMath-Bold.otf',
  'NotoSerifCJKsc-Regular.otf',
];

/** 预览和 PDF 使用同一组随应用分发的字体。 */
export function typstFontUrls(): string[] {
  const base = new URL(`${import.meta.env.BASE_URL}typst-fonts/`, globalThis.location.href);
  return FONT_NAMES.map((name) => new URL(name, base).href);
}
