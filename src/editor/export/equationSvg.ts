import { typstSvgElement } from '../livepreview/typst/typstSvg';

export interface EquationSvg {
  svg: string;
  widthPt: number;
  heightPt: number;
}

/** MathJax 的 SVG viewBox 使用每 em 1000 单位；独立片段以 12pt/em 输出，保留负原点。 */
export function equationSvg(mount: HTMLElement): EquationSvg {
  const invalid = mount.matches('[data-mjx-error], [data-mml-node="merror"], .mjx-output-error')
    ? mount : mount.querySelector<HTMLElement>('[data-mjx-error], [data-mml-node="merror"], .mjx-output-error');
  if (invalid) throw new Error(invalid.getAttribute('data-mjx-error') || invalid.textContent || 'LaTeX 转换失败');
  const original = mount.matches('svg') ? mount : mount.querySelector('svg');
  if (!original) throw new Error('LaTeX 未生成公式 SVG');
  const geometry = original.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (!geometry || geometry.length !== 4 || !geometry.every(Number.isFinite) || geometry[2] <= 0 || geometry[3] <= 0) {
    throw new Error('公式 SVG 尺寸无效');
  }
  const widthPt = geometry[2] * 12 / 1000;
  const heightPt = geometry[3] * 12 / 1000;
  const svg = typstSvgElement(new XMLSerializer().serializeToString(original));
  if (!svg) throw new Error('公式 SVG 无效');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', `${widthPt}pt`);
  svg.setAttribute('height', `${heightPt}pt`);
  svg.setAttribute('style', 'color: #000000');
  svg.setAttribute('color', '#000000');
  return { svg: new XMLSerializer().serializeToString(svg), widthPt, heightPt };
}
