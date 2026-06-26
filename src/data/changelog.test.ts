import { describe, expect, it } from 'vitest';
import { CHANGELOG, changelogFor } from './changelog';

describe('changelog', () => {
  it('最新条目在前，版本/级别字段合法', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    const head = CHANGELOG[0];
    expect(head.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(['major', 'minor', 'patch']).toContain(head.level);
    expect(head.highlights.length).toBeGreaterThan(0);
  });

  it('版本号唯一（不重复展示同版公告）', () => {
    const versions = CHANGELOG.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('changelogFor 命中已知版本、未知版本返 undefined', () => {
    expect(changelogFor(CHANGELOG[0].version)?.version).toBe(CHANGELOG[0].version);
    expect(changelogFor('0.0.0-nope')).toBeUndefined();
  });
});
