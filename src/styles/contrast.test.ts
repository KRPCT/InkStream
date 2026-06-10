import { describe, expect, it } from 'vitest';
import { contrastRatio, hslToRgb } from './contrast';

describe('hslToRgb', () => {
  it('解析纯白与纯红', () => {
    const white = hslToRgb('0, 0%, 100%');
    expect(white.r).toBeCloseTo(1, 5);
    expect(white.g).toBeCloseTo(1, 5);
    expect(white.b).toBeCloseTo(1, 5);

    const red = hslToRgb('0, 100%, 50%');
    expect(red.r).toBeCloseTo(1, 5);
    expect(red.g).toBeCloseTo(0, 5);
    expect(red.b).toBeCloseTo(0, 5);
  });

  it('兼容逗号、空格与 hsl() 包裹三种书写', () => {
    const a = hslToRgb('230, 1%, 98%');
    const b = hslToRgb('230 1% 98%');
    const c = hslToRgb('hsl(230, 1%, 98%)');
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(a.r).toBeGreaterThan(0.97);
  });
});

describe('contrastRatio', () => {
  it('白 vs 黑 = 21:1（±0.01）', () => {
    expect(contrastRatio('0, 0%, 100%', '0, 0%, 0%')).toBeCloseTo(21, 2);
  });

  it('传参顺序无关', () => {
    const ab = contrastRatio('230, 8%, 24%', '230, 1%, 94%');
    const ba = contrastRatio('230, 1%, 94%', '230, 8%, 24%');
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('text-normal 亮 vs background-secondary 亮 ≈ 10.0:1（UI-SPEC 验收表）', () => {
    const ratio = contrastRatio('230, 8%, 24%', '230, 1%, 94%');
    expect(ratio).toBeGreaterThan(9.8);
    expect(ratio).toBeLessThan(10.2);
  });
});
