import type { ProjectDocument } from '../types/projects';

export interface SessionSource { root: string; document: ProjectDocument }
const sources = new Map<string, SessionSource>();
export function sessionSource(path: string): SessionSource | undefined { return sources.get(path); }
export function replaceSessionSources(entries: Iterable<SessionSource>): void {
  sources.clear();
  for (const entry of entries) sources.set(entry.document.path, entry);
}
export function rekeySessionSource(before: string, after: string): void {
  const source = sources.get(before);
  if (source) { sources.delete(before); sources.set(after, { ...source, document: { ...source.document, path: after } }); }
}
export function forgetSessionSource(path: string): void { sources.delete(path); }
