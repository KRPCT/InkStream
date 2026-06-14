import { describe, expect, it } from 'vitest';
import { hasProseChange, proseDiff, tokenizeProse } from './proseDiff';

/** 片段 → 紧凑串 '=句' / '+句' / '-句'（trim 便于断言）。 */
const compact = (oldText: string, newText: string): string[] =>
  proseDiff(oldText, newText).map((s) => {
    const sign = s.status === 'equal' ? '=' : s.status === 'insert' ? '+' : '-';
    return sign + s.text.trim();
  });

describe('tokenizeProse', () => {
  it('中英混排按句切分（。！？ . ! ?）', () => {
    const t = tokenizeProse('你好。世界！Hello world. 再见？');
    expect(t.map((x) => x.key)).toEqual(['你好。', '世界！', 'Hello world.', '再见？']);
  });

  it('空行分段，段序随 token', () => {
    const t = tokenizeProse('第一段句一。第一段句二。\n\n第二段句一。');
    expect(t.map((x) => x.para)).toEqual([0, 0, 1]);
  });

  it('纯空白句被跳过', () => {
    expect(tokenizeProse('  \n\n  \n').length).toBe(0);
  });
});

describe('proseDiff', () => {
  it('空对空 → 空', () => {
    expect(proseDiff('', '')).toEqual([]);
  });

  it('完全相同 → 全 equal', () => {
    const r = proseDiff('一句话。两句话。', '一句话。两句话。');
    expect(r.every((s) => s.status === 'equal')).toBe(true);
    expect(r).toHaveLength(2);
  });

  it('纯新增一句', () => {
    expect(compact('甲。乙。', '甲。乙。丙。')).toEqual(['=甲。', '=乙。', '+丙。']);
  });

  it('纯删除一句', () => {
    expect(compact('甲。乙。丙。', '甲。丙。')).toEqual(['=甲。', '-乙。', '=丙。']);
  });

  it('改写一句 = 删旧 + 插新（仅命中那一句）', () => {
    expect(compact('我喜欢猫。今天天气好。', '我喜欢狗。今天天气好。')).toEqual([
      '-我喜欢猫。',
      '+我喜欢狗。',
      '=今天天气好。',
    ]);
  });

  it('只改空白/换行 → 视为未改（规范化键）', () => {
    const r = proseDiff('一句。  两句。', '一句。\n两句。');
    expect(r.every((s) => s.status === 'equal')).toBe(true);
  });

  it('中英混排：英文句改写只标该句', () => {
    expect(compact('你好。Hello world.', '你好。Hi there.')).toEqual([
      '=你好。',
      '-Hello world.',
      '+Hi there.',
    ]);
  });

  it('跨段：第二段整段新增，段号正确', () => {
    const r = proseDiff('首段。', '首段。\n\n次段一。次段二。');
    expect(r.map((s) => `${s.status}@${s.para}`)).toEqual(['equal@0', 'insert@1', 'insert@1']);
  });

  it('删除句保留旧段号', () => {
    const r = proseDiff('甲段一。甲段二。\n\n乙段。', '甲段一。\n\n乙段。');
    const del = r.find((s) => s.status === 'delete');
    expect(del?.para).toBe(0);
  });
});

describe('hasProseChange', () => {
  it('有插/删 → true，全 equal → false', () => {
    expect(hasProseChange(proseDiff('甲。', '甲。乙。'))).toBe(true);
    expect(hasProseChange(proseDiff('甲。乙。', '甲。乙。'))).toBe(false);
  });
});
