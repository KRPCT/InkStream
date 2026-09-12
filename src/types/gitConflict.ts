export interface ConflictStage { path: string; oid: string; byteLength: number }
export interface ConflictBaseline {
  workingOid: string;
  stages: [ConflictStage | null, ConflictStage | null, ConflictStage | null];
  headOid: string | null;
  operation: string;
}
export interface ConflictSnapshot { baseline: ConflictBaseline; markerError: string | null; conflictCount: number }
export type ConflictPart = 'working' | 'base' | 'ours' | 'theirs';
