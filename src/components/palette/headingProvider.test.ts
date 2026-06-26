import { beforeEach, describe, expect, it, vi } from 'vitest';

const scrollToHeading = vi.hoisted(() => vi.fn());
vi.mock('../../editor/outline', () => ({ scrollToHeading }));

import { useOutlineStore } from '../../stores/useOutlineStore';
import { headingProvider } from './headingProvider';

beforeEach(() => {
  scrollToHeading.mockClear();
  useOutlineStore.setState({
    items: [
      { level: 1, text: '引言', from: 0 },
      { level: 2, text: '研究方法', from: 42 },
      { level: 3, text: '数据来源', from: 88 },
    ],
  });
});

describe('headingProvider', () => {
  it('空 query 列全部标题（文档序），id=from、subtitle=H级别', () => {
    const items = headingProvider.getItems('');
    expect(items.map((i) => i.id)).toEqual(['0', '42', '88']);
    expect(items.map((i) => i.subtitle)).toEqual(['H1', 'H2', 'H3']);
  });

  it('title 按层级缩进（H1 无缩进、H2/H3 前导 en-space）', () => {
    const items = headingProvider.getItems('');
    expect(items[0].title).toBe('引言');
    expect(items[1].title).not.toBe('研究方法');
    expect(items[1].title.trim()).toBe('研究方法'); // 缩进是空白，trim 后即原文
    expect(items[2].title.length).toBeGreaterThan(items[1].title.length); // 越深缩进越多
  });

  it('fuzzy 过滤命中标题', () => {
    const items = headingProvider.getItems('方法');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('42');
  });

  it('onSelect 经 scrollToHeading 跳到该 from', () => {
    headingProvider.onSelect?.('42');
    expect(scrollToHeading).toHaveBeenCalledWith(42);
  });

  it('无标题时返回空列表', () => {
    useOutlineStore.setState({ items: [] });
    expect(headingProvider.getItems('')).toEqual([]);
  });
});
