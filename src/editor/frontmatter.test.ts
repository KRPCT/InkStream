import { describe, expect, it } from 'vitest';
import { LANGUAGE_CYCLE, nextLanguage, readLanguage, writeLanguage } from './frontmatter';

describe('readLanguage', () => {
  it('无 frontmatter 返回 null', () => {
    expect(readLanguage('# 标题\n正文')).toBeNull();
    expect(readLanguage('')).toBeNull();
  });

  it('有 frontmatter 但无 language 行返回 null', () => {
    expect(readLanguage('---\ntitle: 笔记\n---\n正文')).toBeNull();
  });

  it('提取 language 单字段', () => {
    expect(readLanguage('---\nlanguage: markdown\n---\n正文')).toBe('markdown');
    expect(readLanguage('---\nlanguage: latex\n---\n')).toBe('latex');
  });

  it('language: richtext 解析为 richtext', () => {
    expect(readLanguage('---\nlanguage: richtext\n---\n正文')).toBe('richtext');
  });

  it('在多字段中定位 language（保留顺序无关）', () => {
    const doc = '---\ntitle: 我的笔记\nlanguage: typst\ntags: [a, b]\n---\n正文';
    expect(readLanguage(doc)).toBe('typst');
  });

  it('容忍 language 行额外空白', () => {
    expect(readLanguage('---\nlanguage:    rust\n---\n')).toBe('rust');
  });

  it('未闭合的 frontmatter 返回 null（不把全文当头部）', () => {
    expect(readLanguage('---\nlanguage: markdown\n没有结束分隔符')).toBeNull();
  });

  it('不引入 YAML 解析器——仅取 language 行的首个 token', () => {
    // 含引号/注释的复杂 YAML 不做完整解析，仅扫单字段裸值
    expect(readLanguage('---\nlanguage: markdown # 注释\n---\n')).toBe('markdown');
  });

  it('WR-09 正文内的 --- 水平线不被误判为闭合栅栏', () => {
    // 头部真正闭合在第三行，正文有 markdown 水平线 ---；闭合界定须整行锚定，
    // 否则 indexOf('\n---') 会命中正文 `---` 致截断/丢失 language。
    const doc = '---\nlanguage: typst\n---\n正文上段\n---\n正文下段';
    expect(readLanguage(doc)).toBe('typst');
  });

  it('WR-09 正文内 ---- 多破折号不被误判为闭合栅栏', () => {
    const doc = '---\nlanguage: latex\n---\n标题\n----\n下段';
    expect(readLanguage(doc)).toBe('latex');
  });

  it('WR-09 闭合行后可跟尾随空白（--- 后空格仍闭合）', () => {
    const doc = '---\nlanguage: rust\n---  \n正文';
    expect(readLanguage(doc)).toBe('rust');
  });

  it('WR-09 闭合 --- 后立刻有非空白文字则非闭合栅栏', () => {
    // `---foo` 不是 frontmatter 闭合（行非纯 ---），故整篇未闭合 → null。
    expect(readLanguage('---\nlanguage: rust\n---foo\n正文')).toBeNull();
  });
});

describe('writeLanguage', () => {
  it('无 frontmatter 时在文档头创建', () => {
    const out = writeLanguage('# 标题\n正文', 'richtext');
    expect(out).toBe('---\nlanguage: richtext\n---\n# 标题\n正文');
    expect(readLanguage(out)).toBe('richtext');
  });

  it('空文档创建 frontmatter', () => {
    const out = writeLanguage('', 'markdown');
    expect(readLanguage(out)).toBe('markdown');
    expect(out.startsWith('---\nlanguage: markdown\n---\n')).toBe(true);
  });

  it('有 language 行时原地修改，保留其他字段', () => {
    const doc = '---\ntitle: 笔记\nlanguage: markdown\ntags: [x]\n---\n正文';
    const out = writeLanguage(doc, 'latex');
    expect(readLanguage(out)).toBe('latex');
    expect(out).toContain('title: 笔记');
    expect(out).toContain('tags: [x]');
    expect(out).toContain('正文');
    expect(out).not.toContain('language: markdown');
  });

  it('有 frontmatter 但无 language 行时插入 language（保留其他字段）', () => {
    const doc = '---\ntitle: 笔记\n---\n正文';
    const out = writeLanguage(doc, 'richtext');
    expect(readLanguage(out)).toBe('richtext');
    expect(out).toContain('title: 笔记');
    expect(out).toContain('正文');
  });

  it('幂等：写入相同语言不损坏文档', () => {
    const doc = '---\nlanguage: markdown\n---\n正文';
    expect(writeLanguage(doc, 'markdown')).toBe(doc);
  });

  it('WR-09 writeLanguage 不被正文 --- 水平线误截', () => {
    // 正文含水平线 ---：写语言只应改头部，正文（含 --- 行）原样保留。
    const doc = '---\nlanguage: markdown\n---\n上段\n---\n下段';
    const out = writeLanguage(doc, 'latex');
    expect(readLanguage(out)).toBe('latex');
    // 正文两段与中间水平线均保留（未被吞入头部或截断）。
    expect(out).toContain('上段\n---\n下段');
    expect(out).not.toContain('language: markdown');
  });
});

describe('nextLanguage / LANGUAGE_CYCLE', () => {
  it('循环顺序为 markdown→latex→typst→richtext→markdown', () => {
    expect(LANGUAGE_CYCLE).toEqual(['markdown', 'latex', 'typst', 'richtext']);
    expect(nextLanguage('markdown')).toBe('latex');
    expect(nextLanguage('latex')).toBe('typst');
    expect(nextLanguage('typst')).toBe('richtext');
    expect(nextLanguage('richtext')).toBe('markdown');
  });

  it('未知/缺省语言起步进入 markdown 之后（latex）', () => {
    expect(nextLanguage(null)).toBe('latex');
    expect(nextLanguage('python')).toBe('latex');
  });
});
