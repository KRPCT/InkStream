export interface EquationPdfRequest {
  type: 'export-svg-pdf';
  svg: string;
  widthPt: number;
  heightPt: number;
  compilerWasmUrl: string;
  fontUrls: string[];
}

export type EquationPdfResult =
  | { type: 'pdf-result'; ok: true; pdf: Uint8Array }
  | { type: 'pdf-result'; ok: false; error: string };
