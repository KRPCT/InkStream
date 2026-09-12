import type { IndexLocation } from '../types/index';

/** Test-only native acknowledgement. Production never derives storage from a workspace path. */
export function nativeIndexReply(command: string, args?: unknown): IndexLocation | null {
  if (command !== 'index_rebuild' && command !== 'index_switch_vault') return null;
  if (!args || typeof args !== 'object' || !('root' in args) || typeof args.root !== 'string') return null;
  if (command === 'index_switch_vault' && 'enabled' in args && args.enabled === false) return null;
  const projectId = 'projectId' in args && typeof args.projectId === 'string' ? args.projectId : 'fixture-project';
  return { projectId, databaseUrl: `sqlite:/fixture-app-data/indexes/${encodeURIComponent(args.root)}/index.db` };
}
