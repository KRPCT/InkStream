import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';

/**
 * fenced 围栏块嵌套语法高亮的语言描述表（markdown({codeLanguages}) 数组形态）。
 *
 * 纪律（与 blockField 正交，根治冲突）：math / latex / typst 三个 info **不在此表**——它们走 blockField
 * widget 就地渲染（KaTeX/MathJax/typst.ts）。matchLanguageName 找不到 → lang-markdown 的 getCodeParser
 * 返回 null → 该 FencedCode 不嵌套解析（CodeText 保持纯文本待 blockField 据 CodeInfo 替换为 widget）。
 * 两条路径共用同一棵语法树的互斥分支，物理上不打架（已源码核实 getCodeParser 对 null 不下钻）。
 *
 * `latex` 归公式渲染（MathJax），代码块要 LaTeX **源码**高亮请用 ```tex（→ stex）。typst 源码高亮由「打开
 * .typ 文件」覆盖，markdown 内 ```typst 一律是渲染块，故不引 codemirror-lang-typst（其 import 即实例化 320KB wasm）。
 *
 * 懒加载：load 返回 Promise<LanguageSupport>，CM6 首次命中某语言时调 load() dynamic import 对应包，
 * 解析期间该块先 skip（getSkippingParser），import resolve 后自动重解析上色。这些包已是 languages.ts 顶层
 * 同步依赖（首屏已含），import() 命中内存模块零额外体积；Rolldown 去重。字面量 import() 路径方可被静态分析。
 */
/** 走 blockField widget 渲染（KaTeX/MathJax/typst.ts）的 info，必须显式排除出嵌套高亮。 */
const RENDER_INFOS: ReadonlySet<string> = new Set(['math', 'latex', 'typst']);

/**
 * info → 嵌套高亮语言描述（codeLanguages 函数形态）。
 *
 * **必须函数形态 + 显式排除 RENDER_INFOS**：matchLanguageName 的 fuzzy 子串匹配会把 `latex` 误配到 `tex`(stex)
 * （'latex'.indexOf('tex')>-1），从而把 ```latex 当 LaTeX 源码高亮、抢走 blockField 的 MathJax 渲染——数组形态
 * （lang-markdown 内部 fuzzy=true）挡不住此误配。显式排除 math/latex/typst 返回 null，交给 blockField。
 */
export function codeLanguageFor(info: string): LanguageDescription | null {
  if (RENDER_INFOS.has(info)) return null;
  return LanguageDescription.matchLanguageName(CODE_LANGUAGES, info, true);
}

/** 仅供测试：嵌套高亮语言描述表（math/latex/typst 不在表内）。 */
export function markdownCodeLanguages(): readonly LanguageDescription[] {
  return CODE_LANGUAGES;
}

const CODE_LANGUAGES: readonly LanguageDescription[] = buildCodeLanguages();

function buildCodeLanguages(): LanguageDescription[] {
  return [
    LanguageDescription.of({
      name: 'javascript',
      alias: ['js', 'jsx', 'ts', 'tsx', 'typescript', 'node'],
      load: () =>
        import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })),
    }),
    LanguageDescription.of({
      name: 'python',
      alias: ['py'],
      load: () => import('@codemirror/lang-python').then((m) => m.python()),
    }),
    LanguageDescription.of({
      name: 'rust',
      alias: ['rs'],
      load: () => import('@codemirror/lang-rust').then((m) => m.rust()),
    }),
    LanguageDescription.of({
      name: 'json',
      load: () => import('@codemirror/lang-json').then((m) => m.json()),
    }),
    LanguageDescription.of({
      name: 'yaml',
      alias: ['yml'],
      load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
    }),
    LanguageDescription.of({
      name: 'html',
      alias: ['htm'],
      load: () => import('@codemirror/lang-html').then((m) => m.html()),
    }),
    LanguageDescription.of({
      name: 'css',
      load: () => import('@codemirror/lang-css').then((m) => m.css()),
    }),
    LanguageDescription.of({
      name: 'tex',
      alias: ['stex'],
      // legacy StreamLanguage 须包成 LanguageSupport（load 契约要 LanguageSupport，非裸 Language）。
      load: () =>
        import('@codemirror/legacy-modes/mode/stex').then(
          (m) => new LanguageSupport(StreamLanguage.define(m.stex)),
        ),
    }),
    LanguageDescription.of({
      name: 'shell',
      alias: ['sh', 'bash', 'zsh'],
      load: () =>
        import('@codemirror/legacy-modes/mode/shell').then(
          (m) => new LanguageSupport(StreamLanguage.define(m.shell)),
        ),
    }),
    // markdown 嵌套：用裸 markdown()（不带 codeLanguages）断无限自嵌套递归。
    LanguageDescription.of({
      name: 'markdown',
      alias: ['md'],
      load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
    }),
    // 注：math / latex / typst 故意缺席 → 不嵌套高亮，交给 blockField 渲染。
  ];
}
