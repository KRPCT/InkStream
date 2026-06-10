/**
 * WCAG 2.x 对比度纯函数（theme.test.ts 配对消费）。
 * 输入为 HSL 字符串，接受 '230, 1%, 98%'、'220 70% 45%'、'hsl(230, 8%, 24%)' 等形态，
 * 解析时只取前三个数值（h, s%, l%），alpha 不参与对比度计算。
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** HSL 字符串转 0-1 RGB（标准 HSL → RGB 变换）。 */
export function hslToRgb(hsl: string): Rgb {
  const nums = hsl.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 3) throw new Error(`无法解析 HSL: ${hsl}`);
  const h = ((Number(nums[0]) % 360) + 360) % 360;
  const s = Number(nums[1]) / 100;
  const l = Number(nums[2]) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return { r: r + m, g: g + m, b: b + m };
}

/** WCAG 相对亮度（sRGB 线性化加权）。 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 对比度 (L1 + 0.05) / (L2 + 0.05)，与前后景传参顺序无关。 */
export function contrastRatio(fgHsl: string, bgHsl: string): number {
  const l1 = relativeLuminance(hslToRgb(fgHsl));
  const l2 = relativeLuminance(hslToRgb(bgHsl));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
