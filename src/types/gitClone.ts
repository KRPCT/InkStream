export type GitClonePhase = 'editing' | 'cloning' | 'cancelling' | 'cancelled' | 'failed' | 'cloned' | 'opening';

export interface GitCloneFailure {
  code: 'cancelled' | 'failed';
  message: string;
  residualPath?: string;
}
