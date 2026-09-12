import type { GitComparePage, GitCompareSide } from '../types/gitCompare';
import { readTextStream } from './fileStream';
import { invoke } from './invoke';

export function gitCompareFiles(repoRoot: string, fromOid: string, toOid: string, skip = 0, focusPath: string | null = null): Promise<GitComparePage> {
  return invoke('git_compare_files', { repoRoot, fromOid, toOid, skip, limit: 100, focusPath });
}

export function gitCommitFiles(repoRoot: string, commitOid: string, skip = 0, focusPath: string | null = null): Promise<GitComparePage> {
  return invoke('git_commit_files', { repoRoot, commitOid, skip, limit: 100, focusPath });
}

export function gitCompareText(repoRoot: string, side: GitCompareSide | null, signal: AbortSignal): Promise<string> {
  if (!side) return Promise.resolve('');
  if (!side.readable) return Promise.reject(new Error('子模块或超过 100MiB 的文件无法在应用内完整比较。'));
  return readTextStream({ kind: 'gitBlob', repoRoot, commitOid: side.commitOid, blobOid: side.blobOid, path: side.path }, { signal });
}
