import { describe, expect, it } from 'vitest';
import { readFraction, topVisibleIndex } from './readingPosition';

describe('topVisibleIndex', () => {
  const tops = [0, 100, 200, 300];

  it('returns first block at the top', () => {
    expect(topVisibleIndex(tops, 0)).toBe(0);
  });

  it('returns the block whose top is at/above the scroll line', () => {
    expect(topVisibleIndex(tops, 150)).toBe(1);
    expect(topVisibleIndex(tops, 205)).toBe(2);
  });

  it('snaps to a block within the fudge tolerance', () => {
    expect(topVisibleIndex(tops, 98)).toBe(1); // 100 <= 98+4
    expect(topVisibleIndex(tops, 95)).toBe(0); // 100 > 95+4
  });

  it('clamps to the last block past the end', () => {
    expect(topVisibleIndex(tops, 9999)).toBe(3);
  });

  it('breaks equal-top ties toward the first block (no resume drift)', () => {
    expect(topVisibleIndex([0, 100, 100, 200], 100)).toBe(1);
  });

  it('handles an empty document', () => {
    expect(topVisibleIndex([], 50)).toBe(0);
  });
});

describe('readFraction', () => {
  it('maps anchor over total with the last unit at 100%', () => {
    expect(readFraction(0, 10)).toBeCloseTo(0.1);
    expect(readFraction(9, 10)).toBe(1);
    expect(readFraction(4, 5)).toBe(1);
  });

  it('guards empty/zero totals', () => {
    expect(readFraction(0, 0)).toBe(0);
    expect(readFraction(3, 0)).toBe(0);
  });
});
