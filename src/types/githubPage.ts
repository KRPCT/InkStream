import type { DiffHunk, FileDiff } from './git';
export interface GithubPage<T> { items: T[]; nextPage: number | null }
export interface GithubPrFile {
  oldPath: string | null;
  newPath: string | null;
  status: FileDiff['status'];
  hunks: DiffHunk[];
  patchStatus: 'available' | 'unavailable' | 'incomplete' | 'overBudget';
}
export interface GithubPrDiffPage extends GithubPage<GithubPrFile> {
  headOid: string;
  baseOid: string;
  webUrl: string;
  limited: boolean;
}
