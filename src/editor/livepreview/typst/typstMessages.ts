export type TypstWorkerInput =
  | { type: 'init'; compilerWasmUrl: string; rendererWasmUrl: string; fontUrls: string[] }
  | { type: 'compile'; id: number; source: string }
  | { type: 'cancel'; id: number };

export type TypstWorkerOutput =
  | { type: 'ready' }
  | { type: 'init-error'; error: string }
  | { type: 'result'; id: number; ok: true; svg: string }
  | { type: 'result'; id: number; ok: false; error: string };
