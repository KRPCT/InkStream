import { describe, expect, it } from 'vitest';
import { validateVault } from './validateVault';

describe('validateVault', () => {
  it('合法输入原样收敛（最近列表 + 展开态 + 上次路径）', () => {
    const v = validateVault({
      version: 1,
      lastVaultPath: '/v',
      recentVaults: ['/v', '/w'],
      expanded: { '/v': ['notes', 'src'] },
    });
    expect(v.lastVaultPath).toBe('/v');
    expect(v.recentVaults).toEqual(['/v', '/w']);
    expect(v.expanded['/v']).toEqual(['notes', 'src']);
  });

  it('null / 非对象 / 错版本 → 默认空形状，永不抛错', () => {
    for (const bad of [null, undefined, 42, 'x', [], { version: 99 }]) {
      const v = validateVault(bad);
      expect(v.version).toBe(1);
      expect(v.recentVaults).toEqual([]);
      expect(v.lastVaultPath).toBeNull();
      expect(v.expanded).toEqual({});
    }
  });

  it('投毒 recentVaults：非字符串项过滤，超额截断（≤20）', () => {
    const poison = { version: 1, recentVaults: ['/a', 3, null, '/b', {}, '/c'] };
    const v = validateVault(poison);
    expect(v.recentVaults).toEqual(['/a', '/b', '/c']);
    const many = { version: 1, recentVaults: Array.from({ length: 50 }, (_, i) => `/p${i}`) };
    expect(validateVault(many).recentVaults).toHaveLength(20);
  });

  it('投毒 expanded：值非字符串数组的键被丢弃，数组内非字符串过滤', () => {
    const v = validateVault({
      version: 1,
      expanded: { '/v': ['ok', 1, 'two', null], '/w': 'not-array', '/x': 42 },
    });
    expect(v.expanded['/v']).toEqual(['ok', 'two']);
    expect(v.expanded['/w']).toBeUndefined();
    expect(v.expanded['/x']).toBeUndefined();
  });

  it('投毒 lastVaultPath：非字符串收敛为 null', () => {
    expect(validateVault({ version: 1, lastVaultPath: 123 }).lastVaultPath).toBeNull();
    expect(validateVault({ version: 1, lastVaultPath: '' }).lastVaultPath).toBeNull();
  });
});
