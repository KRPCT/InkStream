export interface IndexScope {
  readonly root: string;
  readonly sessionId: string;
  readonly projectId?: string;
}

export interface IndexLocation { projectId: string; databaseUrl: string }

export type IndexStatus = 'disabled' | 'preparing' | 'ready' | 'error';
