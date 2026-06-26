import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ipc/settings', () => ({ saveLastSeenVersion: vi.fn(() => Promise.resolve()) }));
import { saveLastSeenVersion } from '../ipc/settings';
import { CHANGELOG } from '../data/changelog';
import { useWhatsNewStore } from './useWhatsNewStore';

const saved = vi.mocked(saveLastSeenVersion);
const head = CHANGELOG[0];

beforeEach(() => {
  saved.mockClear();
  useWhatsNewStore.setState({ open: false, entry: null, celebrate: false });
});

describe('useWhatsNewStore', () => {
  it('版本已见过：不弹、不落盘', () => {
    useWhatsNewStore.getState().showFor(head.version, head.version);
    expect(useWhatsNewStore.getState().open).toBe(false);
    expect(saved).not.toHaveBeenCalled();
  });

  it('新版本有公告：展示 + 落盘已见 + 按级别决定恭喜动效', () => {
    useWhatsNewStore.getState().showFor(head.version, null);
    const s = useWhatsNewStore.getState();
    expect(s.open).toBe(true);
    expect(s.entry?.version).toBe(head.version);
    expect(s.celebrate).toBe(head.level === 'major' || head.level === 'minor');
    expect(saved).toHaveBeenCalledWith(head.version);
  });

  it('新版本无公告条目：落盘但不弹（避免下次重复检查）', () => {
    useWhatsNewStore.getState().showFor('0.0.0-unknown', '0.0.0-old');
    expect(useWhatsNewStore.getState().open).toBe(false);
    expect(saved).toHaveBeenCalledWith('0.0.0-unknown');
  });

  it('showLatest 手动展示最新公告，不放动效', () => {
    useWhatsNewStore.getState().showLatest();
    const s = useWhatsNewStore.getState();
    expect(s.open).toBe(true);
    expect(s.entry?.version).toBe(head.version);
    expect(s.celebrate).toBe(false);
  });

  it('close 收起并复位动效', () => {
    useWhatsNewStore.setState({ open: true, entry: head, celebrate: true });
    useWhatsNewStore.getState().close();
    const s = useWhatsNewStore.getState();
    expect(s.open).toBe(false);
    expect(s.celebrate).toBe(false);
  });
});
