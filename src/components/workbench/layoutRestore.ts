/** Imperative viewport action; persisted layout remains owned by useWorkbenchStore. */
let restore: (() => void) | null = null;
export function registerLayoutRestore(action: () => void): () => void {
  restore = action;
  return () => { if (restore === action) restore = null; };
}
export function restoreWorkbenchLayout(): void { restore?.(); }
