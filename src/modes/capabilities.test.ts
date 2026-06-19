import { describe, expect, it } from 'vitest';
import { getCapabilities, SIMPLE_RIGHT_TABS } from './capabilities';

describe('getCapabilities', () => {
  it('完整模式所有能力全开', () => {
    const c = getCapabilities(false);
    expect(Object.values(c).every((v) => v === true)).toBe(true);
  });

  it('简易模式所有能力全关', () => {
    const c = getCapabilities(true);
    expect(Object.values(c).some((v) => v === true)).toBe(false);
    expect(c.allowIndex).toBe(false);
  });

  it('简易模式右栏仅保留大纲', () => {
    expect(SIMPLE_RIGHT_TABS).toEqual(['outline']);
  });
});
