import { describe, expect, it } from 'vitest';
import { detectBiblioStyle, planBiblioEdit } from './bibliography';

/** 参考文献占位区域定位回归门（Phase 8 ZOT-04）。纯函数：样式探测 + 最小编辑坐标。 */

describe('detectBiblioStyle', () => {
  it('无占位 → null', () => {
    expect(detectBiblioStyle('正文，无引用。')).toBeNull();
  });

  it('裸标记 → gbt7714（默认）', () => {
    expect(detectBiblioStyle('## 参考文献\n\n<!-- biblio -->\n')).toBe('gbt7714');
  });

  it('带样式标记按其值', () => {
    expect(detectBiblioStyle('<!-- biblio:apa -->')).toBe('apa');
    expect(detectBiblioStyle('<!-- biblio:vancouver -->')).toBe('vancouver');
  });

  it('未知样式回退 gbt7714', () => {
    expect(detectBiblioStyle('<!-- biblio:mla -->')).toBe('gbt7714');
  });
});

describe('planBiblioEdit', () => {
  const block = '<!-- biblio:apa -->\n\nEntry.\n\n<!-- /biblio -->';

  it('无占位 → 文末追加「标题 + block」（doc 末无换行补两空行）', () => {
    const doc = '正文。';
    const r = planBiblioEdit(doc, block);
    expect(r.from).toBe(doc.length);
    expect(r.to).toBe(doc.length);
    expect(r.insert).toBe(`\n\n## 参考文献\n\n${block}\n`);
  });

  it('裸标记 → 仅替换标记本身', () => {
    const doc = '## 参考文献\n\n<!-- biblio -->\n';
    const r = planBiblioEdit(doc, block);
    expect(doc.slice(r.from, r.to)).toBe('<!-- biblio -->');
    expect(r.insert).toBe(block);
  });

  it('已展开区域 → 替换 [marker, 末标记] 整段（幂等重展）', () => {
    const doc = '前文\n\n## 参考文献\n\n<!-- biblio:apa -->\n\n旧条目\n\n<!-- /biblio -->\n尾部';
    const r = planBiblioEdit(doc, block);
    expect(doc.slice(r.from, r.to)).toBe('<!-- biblio:apa -->\n\n旧条目\n\n<!-- /biblio -->');
    // 替换后尾部保留
    const next = doc.slice(0, r.from) + r.insert + doc.slice(r.to);
    expect(next).toBe('前文\n\n## 参考文献\n\n' + block + '\n尾部');
  });
});
