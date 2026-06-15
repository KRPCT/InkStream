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

/**
 * 闭合栅栏的整行锚定匹配（WR-09）：`\n---` 必须独占一行——其后仅允许尾随空白，
 * 再接换行或文档结尾。这样正文里的水平线 `---`/`----`/`---foo` 不会被误判为闭合。
 *
 * 捕获组：m[0] 为完整匹配（含前导 `\n---` 与尾随空白及可能的换行）；末段换行用于
 * 正确推进 bodyStart 到正文首行。
 */
const FENCE_RE = /\n---[ \t]*(?:\n|$)/;

/** 头部 frontmatter 区间 [开始内容偏移, 结束分隔符前偏移]；无闭合头部返回 null。 */
function frontmatterBounds(doc: string): { inner: string; bodyStart: number } | null {
  if (!doc.startsWith(HEAD)) return null;
  // 仅在头部内容区（HEAD 之后）查找整行锚定的闭合栅栏，避免命中正文 ---。
  const rest = doc.slice(HEAD.length);
  const m = FENCE_RE.exec(rest);
  if (!m) return null;
  const end = HEAD.length + m.index; // 闭合 `\n` 前的偏移（inner 截止于此）。
  // 正文起点：跳过整段匹配（`\n---` + 尾随空白 + 末尾换行/EOF）。
  const bodyStart = end + m[0].length;
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

/**
 * 正文起始偏移（frontmatter 之后）；无闭合 frontmatter 返回 0。
 *
 * 供字数统计剔除元数据（countWords 传 doc.slice(bodyStart(doc)) 才不把 YAML 计进字数，CREA-04/01）。
 */
export function bodyStart(doc: string): number {
  return frontmatterBounds(doc)?.bodyStart ?? 0;
}

/**
 * 读取头部多个单行 scalar 字段（Phase 9：场景 title/status/summary、Codex type/name/aliases/summary）。
 *
 * 与 readLanguage 同纪律：仅扫 `---\n...\n---` 头部、flat scalar（值取冒号后整行 trim，支持含空格的值，
 * 如英文标题），不引 js-yaml。无 frontmatter / 某字段缺失 / 值为空 → 该键不出现在返回对象中。
 */
export function readFields(doc: string, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const bounds = frontmatterBounds(doc);
  if (!bounds) return out;
  for (const key of keys) {
    const m = bounds.inner.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
    if (m) {
      const v = m[1].trim();
      if (v !== '') out[key] = v;
    }
  }
  return out;
}

/**
 * 写入/修改头部单行 scalar 字段，保留其他字段（CREA-05 场景概要卡回写 summary 等）。
 * 语义同 writeLanguage：无 frontmatter 则创建头部；有同名行原地替换；无则头部末尾追加。
 */
export function writeField(doc: string, key: string, val: string): string {
  const bounds = frontmatterBounds(doc);
  if (!bounds) {
    return `${HEAD}${key}: ${val}${FENCE}\n${doc}`;
  }
  const { inner, bodyStart: bs } = bounds;
  const body = doc.slice(bs);
  const lineRe = new RegExp(`^${key}:.*$`, 'm');
  let newInner: string;
  if (lineRe.test(inner)) {
    newInner = inner.replace(lineRe, `${key}: ${val}`);
  } else {
    const sep = inner.endsWith('\n') || inner === '' ? '' : '\n';
    newInner = `${inner}${sep}${key}: ${val}`;
  }
  return `${HEAD}${newInner}${FENCE}\n${body}`;
}
