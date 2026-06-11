import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useVaultStore } from '../../stores/useVaultStore';
import type { FileEntry, VaultInfo } from '../../types/vault';
import { fileProvider, rankFiles } from './fileProvider';

const VAULT: VaultInfo = { root: '/vault', repoRoot: null, name: 'vault' };

const FILES: FileEntry[] = [
  { name: '会议纪要.md', path: '笔记/会议纪要.md' },
  { name: 'readme.md', path: 'readme.md' },
  { name: 'index.ts', path: 'src/index.ts' },
];

function setVault(files: FileEntry[]): void {
  useVaultStore.setState({ vault: VAULT, files });
}

describe('rankFiles', () => {
  it('中文文件名 fuzzy 命中（复用 match.ts CJK 配置）', () => {
    const hit = rankFiles('会议', FILES);
    expect(hit.map((e) => e.path)).toContain('笔记/会议纪要.md');
    expect(hit.map((e) => e.path)).not.toContain('readme.md');
  });

  it('英文文件名 fuzzy 命中', () => {
    const hit = rankFiles('index', FILES);
    expect(hit.map((e) => e.path)).toContain('src/index.ts');
    expect(hit.map((e) => e.path)).not.toContain('readme.md');
  });

  it('无匹配返回空', () => {
    expect(rankFiles('zzzz', FILES)).toEqual([]);
  });

  it('空 query 返回全部', () => {
    expect(rankFiles('', FILES)).toHaveLength(FILES.length);
  });
});

describe('fileProvider', () => {
  beforeEach(() => {
    useVaultStore.setState(useVaultStore.getInitialState(), true);
  });
  afterEach(() => {
    useVaultStore.setState(useVaultStore.getInitialState(), true);
  });

  it('prefix 为空字符串（无前缀 provider）', () => {
    expect(fileProvider.prefix).toBe('');
  });

  it('结果行 title 为文件名、subtitle 为相对路径', () => {
    setVault(FILES);
    const items = fileProvider.getItems('会议');
    const item = items.find((i) => i.id === '笔记/会议纪要.md');
    expect(item?.title).toBe('会议纪要.md');
    expect(item?.subtitle).toBe('笔记/会议纪要.md');
  });

  it('无 vault 时无结果', () => {
    const items = fileProvider.getItems('readme');
    expect(items).toEqual([]);
  });

  it('无匹配时返回空数组', () => {
    setVault(FILES);
    expect(fileProvider.getItems('zzzz')).toEqual([]);
  });
});
