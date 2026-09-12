/** 文件读取保持原有调用形状；取消只影响本次读取，不修改文件。 */
export interface FileReadOptions {
  signal?: AbortSignal;
}

export type FileWriteTarget =
  | { kind: 'vault'; root: string; path: string }
  | { kind: 'absolute'; path: string }
  | { kind: 'gitConflict'; repoRoot: string; path: string; baseline: import('./gitConflict').ConflictBaseline };

export interface FileWriteMetadata {
  version: 1;
  requestId: string;
  target: FileWriteTarget;
  encoding: 'utf8' | 'bytes';
  byteLength: number;
  timeoutMs: number;
}

/** 三种读取权限分别沿用文本工作区、阅读格式与图片格式的原有守卫。 */
export type FileReadTarget =
  | { kind: 'text'; root: string; path: string }
  | { kind: 'reading'; path: string }
  | { kind: 'image'; path: string }
  | { kind: 'gitBlob'; repoRoot: string; commitOid: string; path: string; blobOid: string }
  | { kind: 'gitConflict'; repoRoot: string; path: string; baseline: import('./gitConflict').ConflictBaseline; part: import('./gitConflict').ConflictPart };

/** Raw 帧前 8 字节是小端无符号文件偏移，其余为原始内容。 */
export type FileReadMessage =
  | ArrayBuffer
  | { type: 'start'; byteLength: number; chunkBytes: number }
  | { type: 'end'; byteLength: number };
