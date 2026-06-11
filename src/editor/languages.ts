import { Compartment, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { StreamLanguage } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { readLanguage } from './frontmatter';
import { richtextKeymap } from './richtext/keymap';

/**
 * 语言注册表 + Compartment 热切（EDIT-04 / Pattern 5）。
 *
 * 纪律：
 * - 语言扩展放 langCompartment，热切只 reconfigure，绝不重建 EditorState（undo 不串味，Pitfall 3）。
 * - Markdown 用 markdown({...}) GFM base，留 Obsidian 变体（wiki-link/citation）注入点给 Phase 4。
 * - LaTeX/Shell 无一流 lezer 语法，经 @codemirror/legacy-modes 的 StreamLanguage.define 接入。
 * - Typst 经 codemirror-lang-typst@0.4.0：该包 import 即 __wbindgen_start() 实例化 320KB wasm，
 *   故用 dynamic import() 懒加载——首屏同步包不含此 wasm，仅在真正打开 Typst 文档时按需 load。
 */

/** 全 App 单一语言 Compartment，承载当前语言扩展。 */
export const langCompartment = new Compartment();

/** 支持的语言标识（typst 走懒加载，其余同步）。 */
export type LanguageId =
  | 'markdown'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'json'
  | 'yaml'
  | 'html'
  | 'css'
  | 'latex'
  | 'shell'
  | 'typst'
  // richtext 是「编辑视图」标识而非独立语法：底层物理仍是 Markdown（无私有格式，
  // PRD 核心价值），故高亮复用 markdown，仅 frontmatter language 与工具条显隐感知它。
  | 'richtext';

const DEFAULT_LANGUAGE: LanguageId = 'markdown';

/** 文件扩展名 → 语言。未知扩展名回退 markdown（单内核默认以 md 呈现纯文本）。 */
const EXT_TO_LANG: Record<string, LanguageId> = {
  md: 'markdown',
  markdown: 'markdown',
  ts: 'javascript',
  tsx: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'html',
  htm: 'html',
  css: 'css',
  tex: 'latex',
  sh: 'shell',
  bash: 'shell',
  typ: 'typst',
};

/** 同步语言扩展工厂（typst 走懒加载、richtext 复用 markdown，均不在此表）。 */
const SYNC_FACTORY: Record<Exclude<LanguageId, 'typst' | 'richtext'>, () => Extension> = {
  markdown: () => markdown(),
  javascript: () => javascript({ jsx: true, typescript: true }),
  python: () => python(),
  rust: () => rust(),
  json: () => json(),
  yaml: () => yaml(),
  html: () => html(),
  css: () => css(),
  latex: () => StreamLanguage.define(stex),
  shell: () => StreamLanguage.define(shell),
};

/** 由文件路径解析语言标识（大小写不敏感）。 */
export function languageForPath(path: string): LanguageId {
  const lastDot = path.lastIndexOf('.');
  if (lastDot < 0 || lastDot === path.length - 1) return DEFAULT_LANGUAGE;
  const ext = path.slice(lastDot + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? DEFAULT_LANGUAGE;
}

/**
 * 取某语言的同步 Extension（喂 langCompartment / EditorState.create）。
 *
 * typst 同步先返回空扩展（不阻塞首屏 / 不拉 wasm）；真正高亮由 loadTypst() 异步 reconfigure 注入。
 * 未知语言回退 markdown。
 */
export function extensionsForLanguage(lang: string): Extension {
  if (lang === 'typst') return [];
  // richtext 物理为 Markdown：高亮走 markdown（T-02-18），并随语言注入 Ctrl+B/I/U/K 键位——
  // 键位仅在 richtext 文档的 langCompartment 内激活，构成 Ctrl+B 冲突裁决（UI-SPEC 合约）。
  if (lang === 'richtext') return [SYNC_FACTORY.markdown(), richtextKeymap()];
  const factory =
    SYNC_FACTORY[lang as Exclude<LanguageId, 'typst' | 'richtext'>] ?? SYNC_FACTORY.markdown;
  return factory();
}

/**
 * 懒加载 Typst 语言支持并热切进 compartment。
 *
 * codemirror-lang-typst 顶层有 __wbindgen_start() 副作用（实例化 320KB wasm），
 * 故必须 dynamic import()——只有打开 .typ 文档调用本函数时才付出该体积。
 */
async function loadTypst(view: EditorView): Promise<void> {
  const mod = await import('codemirror-lang-typst');
  view.dispatch({ effects: langCompartment.reconfigure(mod.typst()) });
}

/**
 * 热切当前语言（Pattern 5）：只 reconfigure compartment，不重建 state。
 *
 * typst 先切到占位（空扩展），随后异步 load 真实高亮再二次 reconfigure。
 */
export function switchLanguage(view: EditorView, lang: string): void {
  view.dispatch({ effects: langCompartment.reconfigure(extensionsForLanguage(lang)) });
  if (lang === 'typst') {
    void loadTypst(view);
  }
}

/**
 * 文档实际语言：frontmatter `language:` 优先于文件扩展名（D-13 文档为单一真相源）。
 * frontmatter 无 language 行则回退 languageForPath（EDIT-04 按扩展名）。
 */
export function languageFromDoc(doc: string, path: string): string {
  return readLanguage(doc) ?? languageForPath(path);
}

/**
 * 头部 language 变化时热切（D-13：手动编辑 frontmatter 同样生效）。
 *
 * 仅在「解析出的语言」与「当前 compartment 语言」不同才 reconfigure，避免每次按键空切。
 * 经 updateListener（useCodeMirror）在 docChanged 时调用；reconfigure 不重建 state（Pitfall 3）。
 */
export function reconfigureLanguageFromDoc(view: EditorView, path: string): void {
  const lang = languageFromDoc(view.state.doc.toString(), path);
  if (lang === lastAppliedLanguage.get(view)) return;
  lastAppliedLanguage.set(view, lang);
  switchLanguage(view, lang);
}

/** 每 view 上一次已应用的语言（避免重复 reconfigure；WeakMap 随 view 释放）。 */
const lastAppliedLanguage = new WeakMap<EditorView, string>();

/** openFile 后登记初始语言，使后续 reconfigureLanguageFromDoc 能正确比对差量。 */
export function markAppliedLanguage(view: EditorView, lang: string): void {
  lastAppliedLanguage.set(view, lang);
}
