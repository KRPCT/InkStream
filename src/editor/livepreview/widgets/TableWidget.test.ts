import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TableWidget } from './TableWidget';

/**
 * GFM 表格 widget 回归门（块级层 / RESEARCH Security V5 XSS 防护 + 性能纪律 eq）。
 *
 * 断言四件事：
 *   1. 结构：2 列 2 数据行表格 sourceText 构建出含正确 <th>/<td> 数的真 <table>；
 *   2. XSS 防护：含 `<img src=x onerror=alert(1)>` 的单元格——table 内无 img 元素、
 *      单元格 textContent 含字面 `<img` 字符串（内容作纯文本，绝不 innerHTML 执行）；
 *   3. eq：同 sourceText 返回 true、异 sourceText 返回 false（source-slice 复用防闪烁）；
 *   4. 源纪律：TableWidget.ts 用 createElement 构建且不含 innerHTML、无硬编码色（var(--cm-table-*)）。
 */

/** 用 sourceText 构建一个挂载到 jsdom 的 <table>。 */
function buildTable(source: string): HTMLTableElement {
  const dom = new TableWidget(source).toDOM();
  expect(dom.tagName.toLowerCase()).toBe('table');
  return dom as HTMLTableElement;
}

const TWO_BY_TWO = ['| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');

describe('TableWidget 结构', () => {
  it('2 列表格构建出含正确 th/td 数的 <table>', () => {
    const table = buildTable(TWO_BY_TWO);

    const ths = table.querySelectorAll('th');
    const tds = table.querySelectorAll('td');
    // 表头 2 个 th（a / b）。
    expect(ths.length).toBe(2);
    expect(ths[0].textContent).toBe('a');
    expect(ths[1].textContent).toBe('b');
    // 2 数据行 x 2 列 = 4 个 td（1 2 / 3 4）；对齐分隔行不产生单元格。
    expect(tds.length).toBe(4);
    expect(Array.from(tds).map((c) => c.textContent)).toEqual(['1', '2', '3', '4']);
  });

  it('表头进 <thead>、数据行进 <tbody>', () => {
    const table = buildTable(TWO_BY_TWO);
    expect(table.querySelector('thead th')).not.toBeNull();
    expect(table.querySelectorAll('tbody tr').length).toBe(2);
  });
});

describe('TableWidget XSS 防护（T-03-12）', () => {
  it('单元格含 <img onerror> 时不生成 img、内容作纯文本', () => {
    const malicious = [
      '| h |',
      '| - |',
      '| <img src=x onerror=alert(1)> |',
    ].join('\n');
    const table = buildTable(malicious);

    // 绝不解析为真实 img 元素（无 innerHTML 注入）。
    expect(table.querySelector('img')).toBeNull();
    // 单元格 textContent 含字面 `<img` 字符串（内容逐字作纯文本）。
    const cell = table.querySelector('tbody td');
    expect(cell).not.toBeNull();
    expect(cell!.textContent).toContain('<img');
    expect(cell!.textContent).toContain('onerror');
  });
});

describe('TableWidget eq（source-slice 复用）', () => {
  it('同 sourceText 返回 true、异 sourceText 返回 false', () => {
    const a = new TableWidget(TWO_BY_TWO);
    const b = new TableWidget(TWO_BY_TWO);
    const c = new TableWidget('| x |\n| - |\n| 9 |');
    expect(a.eq(b)).toBe(true);
    expect(a.eq(c)).toBe(false);
  });
});

describe('TableWidget 源纪律', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/editor/livepreview/widgets/TableWidget.ts'),
    'utf8',
  );

  it('用 createElement 构建且不含 innerHTML（XSS 防护）', () => {
    expect(src).toContain('createElement');
    expect(src).not.toContain('innerHTML');
  });

  it('无硬编码色值（var(--cm-table-*) 纪律）', () => {
    expect(src).not.toMatch(/color:\s*['"]#/);
    expect(src).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/);
  });
});
