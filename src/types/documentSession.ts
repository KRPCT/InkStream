/** A resolved save request is not necessarily a successful persistence operation. */
export type SaveOutcome =
  | { kind: 'saved' }
  | { kind: 'changed' }
  | { kind: 'failed' }
  | { kind: 'blocked'; reason: 'suspended' | 'conflict' | 'draft' | 'missing' };
