/** A comparison pins the selected branch tips; later branch movement cannot change its body. */
export interface GitCompareSide {
  commitOid: string;
  blobOid: string;
  path: string;
  byteLength: number;
  readable: boolean;
}
export interface GitCompareFile {
  status: 'added' | 'deleted' | 'renamed' | 'modified' | 'typechange' | 'unchanged';
  old: GitCompareSide | null;
  new: GitCompareSide | null;
}
export interface GitComparePage {
  fromOid: string;
  toOid: string;
  total: number;
  next: number | null;
  files: GitCompareFile[];
}
export interface GitComparison {
  from: { name: string; oid: string };
  to: { name: string; oid: string };
}
