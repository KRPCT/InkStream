import { beforeEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ load: vi.fn(), close: vi.fn().mockResolvedValue(true) }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: io.load } }));
import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import { bindIndexLocation, indexDbUrl } from './indexLocation';
import { captureIndexScope } from './indexScope';
import { closeIndexReads, indexConnection, retireIndexRead } from './indexConnection';

let count = 0;
beforeEach(() => {
  io.load.mockReset().mockResolvedValue({ select: vi.fn(), close: io.close }); io.close.mockClear();
  useSettingsStore.setState({ simpleMode: false });
  const vault = { root: `/user-content/${++count}`, name: 'A', repoRoot: null, projectId: 'A' };
  useVaultStore.setState({ vault });
});

it('没有原生位置不打开数据库，不能回退到用户目录', async () => {
  const scope = captureIndexScope()!;
  await expect(indexConnection(scope)).rejects.toThrow('尚未确认');
  expect(io.load).not.toHaveBeenCalled();
});

it('项目身份随工作区scope固定，只使用原生URL并精确关闭同一个池', async () => {
  const scope = captureIndexScope()!;
  expect(scope.projectId).toBe('A');
  bindIndexLocation(scope, { projectId: 'A', databaseUrl: 'sqlite:/app-data/indexes/A/index.db' });
  await indexConnection(scope);
  expect(io.load).toHaveBeenCalledWith('sqlite:/app-data/indexes/A/index.db');
  const vault = { root: '/user-content/B', name: 'B', repoRoot: null, projectId: 'B' };
  useVaultStore.setState({ vault });
  const next = captureIndexScope()!;
  bindIndexLocation(next, { projectId: 'B', databaseUrl: 'sqlite:/app-data/indexes/B/index.db' });
  await indexConnection(next);
  expect(io.close).toHaveBeenCalledWith('sqlite:/app-data/indexes/A/index.db');
  expect(io.load).toHaveBeenLastCalledWith('sqlite:/app-data/indexes/B/index.db');
  retireIndexRead(next); await closeIndexReads();
  expect(io.close).toHaveBeenLastCalledWith('sqlite:/app-data/indexes/B/index.db');
});

it('同一会话不接受换项目或换地址，原连接仍按第一次原生身份关闭', async () => {
  const scope = captureIndexScope()!;
  bindIndexLocation(scope, { projectId: 'A', databaseUrl: 'sqlite:/app-data/indexes/A/index.db' });
  expect(() => bindIndexLocation(scope, { projectId: 'B', databaseUrl: 'sqlite:/app-data/indexes/B/index.db' })).toThrow('不属于');
  expect(() => bindIndexLocation(scope, { projectId: 'A', databaseUrl: 'sqlite:/different/index.db' })).toThrow('发生变化');
  expect(indexDbUrl(scope)).toBe('sqlite:/app-data/indexes/A/index.db');
});
