import { describe, expect, it } from 'vitest';
import { assembleResolution, conflictCount, parseConflicts } from './parseConflicts';

describe('strict conflict parsing and exact resolution', () => {
  it('preserves diff3 base and CRLF bytes outside and inside the chosen side', () => {
    const parsed = parseConflicts('before\r\n<<<<<<< HEAD\r\nours\r\n||||||| base\r\nbase\r\n=======\r\ntheirs\r\n>>>>>>> topic\r\nafter');
    expect(parsed).toEqual({ kind: 'valid', parts: [{ kind: 'clean', text: 'before\r\n' }, { kind: 'conflict', ours: 'ours\r\n', base: 'base\r\n', theirs: 'theirs\r\n' }, { kind: 'clean', text: 'after' }] });
    expect(assembleResolution(parsed, ['theirs'])).toBe('before\r\ntheirs\r\nafter');
    expect(assembleResolution(parsed, ['both'])).toBe('before\r\nours\r\ntheirs\r\nafter');
  });
  it('handles adjacent conflicts, empty sides and custom marker widths without adding newlines', () => {
    const parsed = parseConflicts('<<<<<<<<< a\n=========\nx\n>>>>>>>>> b\n<<<<<<<<< a\ny\n=========\n>>>>>>>>> b\n');
    expect(conflictCount(parsed)).toBe(2);
    expect(assembleResolution(parsed, ['ours', 'theirs'])).toBe('');
    expect(assembleResolution(parsed, ['both', 'both'])).toBe('x\ny\n');
  });
  it.each([
    '<<<<<<< a\nours\n',
    '<<<<<<< a\nours\n>>>>>>> b\n',
    '<<<<<<< a\nours\n=======\ntheirs\n',
    '<<<<<<< a\n<<<<<<< nested\n=======\nx\n>>>>>>> b\n',
    '<<<<<<< a\nx\n========\ny\n>>>>>>> b\n',
    '<<<<<<< a\nx\n=======\n=======\ny\n>>>>>>> b\n',
    '||||||| orphan\nbase\n=======\nx\n>>>>>>> b\n',
  ])('rejects damaged source without offering an assembled result: %s', (source) => {
    const parsed = parseConflicts(source);
    expect(parsed.kind).toBe('invalid');
    expect(() => assembleResolution(parsed, ['ours'])).toThrow();
  });
  it('preserves ordinary marker characters and standalone Markdown heading underlines', () => {
    for (const source of ['a <<<<<<< literal\n', '<<<<<<<not-a-marker\n', 'Heading\n=======\ntext\n']) {
      expect(assembleResolution(parseConflicts(source), [])).toBe(source);
    }
  });
  it('does not silently default an unreviewed or stale choice to ours', () => {
    const parsed = parseConflicts('<<<<<<< a\nx\n=======\ny\n>>>>>>> b\n');
    expect(() => assembleResolution(parsed, [])).toThrow('每处冲突');
    expect(() => assembleResolution(parsed, ['ours', 'theirs'])).toThrow('不一致');
  });
});
