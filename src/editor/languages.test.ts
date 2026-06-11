import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import {
  extensionsForLanguage,
  langCompartment,
  languageForPath,
  switchLanguage,
} from './languages';

const root = process.cwd();
const languagesSrc = readFileSync(resolve(root, 'src/editor/languages.ts'), 'utf8');

describe('languageForPath', () => {
  const cases: Array<[string, string]> = [
    ['notes/readme.md', 'markdown'],
    ['a/b.ts', 'javascript'],
    ['a/b.tsx', 'javascript'],
    ['a/b.js', 'javascript'],
    ['a/b.jsx', 'javascript'],
    ['main.py', 'python'],
    ['lib.rs', 'rust'],
    ['data.json', 'json'],
    ['conf.yaml', 'yaml'],
    ['conf.yml', 'yaml'],
    ['page.html', 'html'],
    ['style.css', 'css'],
    ['paper.tex', 'latex'],
    ['run.sh', 'shell'],
    ['doc.typ', 'typst'],
  ];

  it.each(cases)('%s → %s', (path, expected) => {
    expect(languageForPath(path)).toBe(expected);
  });

  it('未知扩展名回退 markdown（单内核默认文本以 md 呈现）', () => {
    expect(languageForPath('a/b.unknownext')).toBe('markdown');
    expect(languageForPath('noext')).toBe('markdown');
  });

  it('大小写不敏感', () => {
    expect(languageForPath('README.MD')).toBe('markdown');
    expect(languageForPath('Main.PY')).toBe('python');
  });
});

describe('extensionsForLanguage', () => {
  const langs = [
    'markdown',
    'javascript',
    'python',
    'rust',
    'json',
    'yaml',
    'html',
    'css',
    'latex',
    'shell',
    'typst',
  ];

  it.each(langs)('%s 返回非空 Extension（同步可用）', (lang) => {
    const ext = extensionsForLanguage(lang);
    expect(ext).toBeDefined();
    // Extension 可能是数组或对象，均非 null/undefined。
    expect(ext === null || ext === undefined).toBe(false);
  });

  it('未知语言回退 markdown 同款（不抛错）', () => {
    expect(() => extensionsForLanguage('nonsense')).not.toThrow();
  });
});

describe('langCompartment 热切（Pattern 5，不重建 state）', () => {
  it('reconfigure 后 javascript 语法树识别关键字', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: 'const x = 1;',
        extensions: [langCompartment.of(extensionsForLanguage('markdown'))],
      }),
    });
    const before = view.state;
    switchLanguage(view, 'javascript');
    // 同一 state 实例链上 reconfigure，doc 不变（未重建）。
    expect(view.state.doc.toString()).toBe('const x = 1;');
    expect(view.state).not.toBe(before);

    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    expect(tree).not.toBeNull();
    // javascript 语法树应含 VariableDeclaration / keyword 节点之一。
    let hasJsNode = false;
    tree?.iterate({
      enter: (node) => {
        if (/VariableDeclaration|Keyword|const/i.test(node.name)) hasJsNode = true;
      },
    });
    expect(hasJsNode).toBe(true);
    view.destroy();
  });

  it('reconfigure 到 markdown 后标题节点存在', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: '# Title\n',
        extensions: [langCompartment.of(extensionsForLanguage('javascript'))],
      }),
    });
    switchLanguage(view, 'markdown');
    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    let hasHeading = false;
    tree?.iterate({
      enter: (node) => {
        if (/Heading|ATXHeading/i.test(node.name)) hasHeading = true;
      },
    });
    expect(hasHeading).toBe(true);
    view.destroy();
  });
});

describe('typst 懒加载纪律（320KB wasm 不进首屏同步包）', () => {
  it('源码用 dynamic import() 加载 codemirror-lang-typst', () => {
    expect(languagesSrc).toMatch(/import\(\s*['"]codemirror-lang-typst['"]\s*\)/);
  });

  it('源码顶层无对 codemirror-lang-typst 的静态 import', () => {
    expect(languagesSrc).not.toMatch(/^\s*import\s+.*from\s+['"]codemirror-lang-typst['"]/m);
  });

  it('LaTeX/Shell 经 StreamLanguage.define 接入 legacy-modes', () => {
    expect(languagesSrc).toContain('StreamLanguage.define');
  });
});
