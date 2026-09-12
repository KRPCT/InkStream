import { invoke } from './invoke';
import { readTextStream } from './fileStream';
import { writeTextRaw } from './fileWrite';
import type { ConflictBaseline, ConflictPart, ConflictSnapshot } from '../types/gitConflict';

export function gitConflictSnapshot(repoRoot: string, path: string): Promise<ConflictSnapshot> {
  return invoke('git_conflict_snapshot', { repoRoot, path });
}
export function gitConflictText(repoRoot: string, path: string, baseline: ConflictBaseline, part: ConflictPart, signal: AbortSignal): Promise<string> {
  return readTextStream({ kind: 'gitConflict', repoRoot, path, baseline, part }, { signal });
}
export function gitSaveConflict(repoRoot: string, path: string, baseline: ConflictBaseline, content: string, signal?: AbortSignal): Promise<null> {
  return writeTextRaw({ kind: 'gitConflict', repoRoot, path, baseline }, content, { signal });
}
