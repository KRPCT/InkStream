export interface IndexScope {
  readonly root: string;
  readonly sessionId: string;
}

export type IndexStatus = 'disabled' | 'preparing' | 'ready' | 'error';
