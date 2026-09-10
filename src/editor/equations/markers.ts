export const EQUATION_NUMBERING_MARKER = '<!-- equation-numbering -->';
const LABEL = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]{0,79}$/u;

export function normalizeEquationLabel(value: string): string | null {
  const label = value.trim().normalize('NFC');
  return LABEL.test(label) ? label : null;
}

export type EquationMarker = { kind: 'mode' } | { kind: 'label'; rawLabel: string; label: string | null };

export function parseEquationMarker(text: string): EquationMarker | null {
  const trimmed = text.trim();
  if (trimmed === EQUATION_NUMBERING_MARKER) return { kind: 'mode' };
  const match = /^<!--\s*equation\s*:(.*?)-->$/s.exec(trimmed);
  if (!match) return null;
  const rawLabel = match[1].trim();
  return { kind: 'label', rawLabel, label: normalizeEquationLabel(rawLabel) };
}

export function equationLabelMarker(label: string): string { return `<!-- equation:${label} -->`; }
export function equationReferenceLabel(target: string): string | null {
  return target.startsWith('#eq:') ? normalizeEquationLabel(target.slice(4)) : null;
}
export const equationAnchorId = (label: string): string => `equation-${label}`;
export const equationNumberText = (ordinal: number): string => `（${ordinal}）`;
export const equationReferenceText = (ordinal: number): string => `式${equationNumberText(ordinal)}`;

/** 只隐藏明确的应用协议；普通或未知注释继续作为转义后的文本导出。 */
export function isHiddenAcademicComment(text: string): boolean {
  const marker = parseEquationMarker(text);
  if (marker?.kind === 'mode' || (marker?.kind === 'label' && marker.label !== null)) return true;
  return /^<!--\s*(?:biblio(?::(?:gbt7714|apa|vancouver))?|\/biblio)\s*-->$/.test(text.trim());
}
