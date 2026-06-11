/**
 * 文档头部 YAML `language:` 单字段解析与写入（EDIT-05 / RESEARCH Pattern 6）。
 *
 * 纪律：
 * - 不引 js-yaml / yaml（零信任 + 仅需单字段）——只扫 `---\n...\n---` 头部的 `language:` 行。
 * - 永不抛错：异型输入回 null（同 validateSettings.ts 取向，frontmatter 由用户手写可任意）。
 * - 写入保留其他字段：只改/插 language 行，不重排或丢弃其余 YAML（文档为单一真相源，D-13）。
 * - language 是文档语言真相源（markdown/latex/typst/richtext）；未知值不在此校验，
 *   交 languages.ts 的白名单回退（T-02-16：不执行任意输入）。
 */

/** 命令「切换文档语言」的循环顺序（D-13；写入/修改 frontmatter language）。 */
export const LANGUAGE_CYCLE = ['markdown', 'latex', 'typst', 'richtext'] as const;

const HEAD = '---\n';
const FENCE = '\n---';

/** 头部 frontmatter 区间 [开始内容偏移, 结束分隔符前偏移]；无闭合头部返回 null。 */
function frontmatterBounds(doc: string): { inner: string; bodyStart: number } | null {
  if (!doc.startsWith(HEAD)) return null;
  const end = doc.indexOf(FENCE, HEAD.length);
  if (end < 0) return null;
  // 结束分隔符行后即正文；FENCE 后通常跟 '\n'（吃掉它使正文从下一行起）。
  let bodyStart = end + FENCE.length;
  if (doc[bodyStart] === '\n') bodyStart += 1;
  return { inner: doc.slice(HEAD.length, end), bodyStart };
}

/**
 * 读取头部 `language:` 单字段。
 * 无 frontmatter / 未闭合 / 无 language 行 → null；否则返回裸值首 token。
 */
export function readLanguage(doc: string): string | null {
  const bounds = frontmatterBounds(doc);
  if (!bounds) return null;
  const m = bounds.inner.match(/^language:\s*(\S+)/m);
  return m ? m[1] : null;
}

/**
 * 写入/修改头部 `language:` 字段，保留其他字段。
 * - 无 frontmatter：在文档头创建 `---\nlanguage: {lang}\n---\n`，原文档接其后。
 * - 有 frontmatter 含 language 行：原地替换该行的值。
 * - 有 frontmatter 无 language 行：在头部末尾追加 language 行。
 */
export function writeLanguage(doc: string, lang: string): string {
  const bounds = frontmatterBounds(doc);
  if (!bounds) {
    return `${HEAD}language: ${lang}${FENCE}\n${doc}`;
  }
  const { inner, bodyStart } = bounds;
  const body = doc.slice(bodyStart);
  let newInner: string;
  if (/^language:\s*\S+/m.test(inner)) {
    newInner = inner.replace(/^language:\s*\S+.*$/m, `language: ${lang}`);
  } else {
    const sep = inner.endsWith('\n') || inner === '' ? '' : '\n';
    newInner = `${inner}${sep}language: ${lang}`;
  }
  return `${HEAD}${newInner}${FENCE}\n${body}`;
}

/** 当前语言的下一档（命令循环切换；缺省/未知从 markdown 之后起步）。 */
export function nextLanguage(current: string | null): (typeof LANGUAGE_CYCLE)[number] {
  const found = current
    ? LANGUAGE_CYCLE.indexOf(current as (typeof LANGUAGE_CYCLE)[number])
    : -1;
  // null/未知（不在循环表内）视作处于 markdown（idx 0），故下一档为 latex。
  const idx = found < 0 ? 0 : found;
  return LANGUAGE_CYCLE[(idx + 1) % LANGUAGE_CYCLE.length];
}
