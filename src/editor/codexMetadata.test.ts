import { describe, expect, it } from 'vitest';
import { parseCodexEntry, updateCodexMetadata } from './codexMetadata';

describe('Codex plain text metadata contract', () => {
  it('round-trips quoted punctuation, dollar expressions, aliases and multiline summaries without changing the body', () => {
    const source = '---\r\nname: 旧名\r\ntype: character\r\nprivate: keep\r\n---\r\n\r\n正文\r\n---\r\n另一段。\r\n';
    const fields = { type: 'character' as const, name: '$& 林:深 #一', aliases: ['小林', '林“深”'], summary: '第一行\n第二行 $&' };
    const saved = updateCodexMetadata(source, fields);
    expect(parseCodexEntry('Codex/a.md', saved)).toMatchObject(fields);
    expect(saved.endsWith('\r\n\r\n正文\r\n---\r\n另一段。\r\n')).toBe(true);
    expect(saved).toContain('private: keep');
  });
  it('reports duplicate and unsupported fields instead of silently choosing a misleading name', () => {
    expect(() => parseCodexEntry('a', '---\ntype: character\nname: A\nname: B\n---\n')).toThrow('重复');
    expect(() => parseCodexEntry('a', '---\ntype: character\nname: |\n  first\n---\n')).toThrow('单行');
    expect(() => parseCodexEntry('a', '---\ntype: character\nname: "broken\n---\n')).toThrow();
  });
});
