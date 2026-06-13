import { syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { extensionsForLanguage } from './languages';
import { useEditorStore } from '../stores/useEditorStore';
import {
  bold,
  bulletList,
  clearFormat,
  codeFence,
  highlight,
  inlineCode,
  insertImage,
  isMarkdownFamily,
  italic,
  link,
  mathBlock,
  orderedList,
  paragraph,
  quote,
  runMarkdownCommand,
  setHeading,
  strikethrough,
  table,
  taskList,
} from './markdownCommands';
import { setView } from './viewHandle';

let view: EditorView;

function mount(doc: string, anchor: number, head = anchor): EditorView {
  view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.single(anchor, head) }),
  });
  return view;
}

function selectedText(): string {
  const r = view.state.selection.main;
  return view.state.doc.sliceString(r.from, r.to);
}

afterEach(() => view?.destroy());

describe('行内格式（格式▸，复用 wrapSelection，产物皆合法 Markdown）', () => {
  it('加粗包 ** **', () => {
    mount('hello world', 6, 11);
    bold(view);
    expect(view.state.doc.toString()).toBe('hello **world**');
  });

  it('斜体包 * *', () => {
    mount('hi', 0, 2);
    italic(view);
    expect(view.state.doc.toString()).toBe('*hi*');
  });

  it('行内代码包反引号', () => {
    mount('code', 0, 4);
    inlineCode(view);
    expect(view.state.doc.toString()).toBe('`code`');
  });

  it('删除线包 ~~ ~~', () => {
    mount('gone', 0, 4);
    strikethrough(view);
    expect(view.state.doc.toString()).toBe('~~gone~~');
  });

  it('高亮包 == ==', () => {
    mount('hot', 0, 3);
    highlight(view);
    expect(view.state.doc.toString()).toBe('==hot==');
  });

  it('链接产生 [选区](url) 且选中 url 占位', () => {
    mount('docs', 0, 4);
    link(view);
    expect(view.state.doc.toString()).toBe('[docs](url)');
    expect(selectedText()).toBe('url');
  });

  it('插入图片 ![选区]() 光标在 ![ 后', () => {
    mount('', 0);
    insertImage(view);
    expect(view.state.doc.toString()).toBe('![]()');
    expect(view.state.selection.main.head).toBe(2);
  });
});

describe('清除格式', () => {
  it('剥除选区两侧成对加粗标记', () => {
    // 选中 ** 之间的 word
    mount('**word**', 2, 6);
    clearFormat(view);
    expect(view.state.doc.toString()).toBe('word');
    expect(selectedText()).toBe('word');
  });

  it('无成对标记则不动', () => {
    mount('plain', 0, 5);
    clearFormat(view);
    expect(view.state.doc.toString()).toBe('plain');
  });
});

describe('段落级前缀（段落▸）', () => {
  it('设标题 2：行首加 ## ', () => {
    mount('Title', 0);
    setHeading(2)(view);
    expect(view.state.doc.toString()).toBe('## Title');
  });

  it('切标题级别：先清旧 # 再加新（不叠加）', () => {
    mount('# Old', 3);
    setHeading(3)(view);
    expect(view.state.doc.toString()).toBe('### Old');
  });

  it('正文清除标题前缀', () => {
    mount('### Heading', 5);
    paragraph(view);
    expect(view.state.doc.toString()).toBe('Heading');
  });

  it('无序列表多行各加 - ', () => {
    mount('a\nb\nc', 0, 5);
    bulletList(view);
    expect(view.state.doc.toString()).toBe('- a\n- b\n- c');
  });

  it('有序列表多行从 1 递增', () => {
    mount('a\nb\nc', 0, 5);
    orderedList(view);
    expect(view.state.doc.toString()).toBe('1. a\n2. b\n3. c');
  });

  it('任务列表加 - [ ] ', () => {
    mount('todo', 0);
    taskList(view);
    expect(view.state.doc.toString()).toBe('- [ ] todo');
  });

  it('引用加 > ', () => {
    mount('cite', 0);
    quote(view);
    expect(view.state.doc.toString()).toBe('> cite');
  });
});

describe('块级插入', () => {
  it('代码块插入围栏，光标在内', () => {
    mount('', 0);
    codeFence(view);
    expect(view.state.doc.toString()).toBe('```\n\n```');
    expect(view.state.selection.main.head).toBe(4);
  });

  it('数学块插入 $$，光标在内', () => {
    mount('', 0);
    mathBlock(view);
    expect(view.state.doc.toString()).toBe('$$\n\n$$');
    expect(view.state.selection.main.head).toBe(3);
  });

  it('表格插入 GFM 管线表模板（空表头，无预设文本）', () => {
    mount('', 0);
    table(view);
    // 表头单元格为空（去「列 1/列 2」占位），但仍是合法 GFM：对齐分隔行界定 2 列。
    expect(view.state.doc.toString()).toBe('|  |  |\n| --- | --- |\n|  |  |\n');
    expect(view.state.doc.toString()).toContain('| --- | --- |');
    // 表头无预设占位文本。
    expect(view.state.doc.toString()).not.toContain('列 1');
  });
});

describe('插入表格另起新块（前后补空行隔断，GFM 不与相邻内容合并）', () => {
  /** 用 GFM 语言挂载 view，便于按语法树数 Table 节点。 */
  function mountMd(doc: string, anchor: number): EditorView {
    view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(anchor),
        extensions: [extensionsForLanguage('markdown')],
      }),
    });
    return view;
  }

  /** 语法树中 Table 节点数。 */
  function tableCount(v: EditorView): number {
    let n = 0;
    syntaxTree(v.state).iterate({
      enter: (node) => {
        if (node.name === 'Table') n += 1;
      },
    });
    return n;
  }

  it('紧接已有表格后插入：解析为两张独立表（中间有空行）', () => {
    const existing = '| x | y |\n| --- | --- |\n| 1 | 2 |\n';
    mountMd(existing, existing.length);
    table(view);
    const doc = view.state.doc.toString();
    // 两表之间必有空行隔断（新表为空表头模板）。
    expect(doc).toContain('| 1 | 2 |\n\n|  |  |\n| --- | --- |');
    expect(tableCount(view)).toBe(2);
  });

  it('紧接段落后插入：表格独立成块，不被并入上文段落', () => {
    const para = '上文段落。';
    mountMd(para, para.length);
    table(view);
    const doc = view.state.doc.toString();
    expect(doc).toContain('上文段落。\n\n|  |  |\n| --- | --- |');
    // 段落 + 表格各自成块（Table 恰一张，证明未与段落混解析）。
    expect(tableCount(view)).toBe(1);
    expect(syntaxTree(view.state).topNode.getChild('Table')).not.toBeNull();
  });

  it('插入到两段之间：前后各补空行，上下文均不被吞并', () => {
    const doc0 = '前段。\n\n后段。';
    mountMd(doc0, 4); // 落在两段之间的空行处。
    table(view);
    const doc = view.state.doc.toString();
    // 表格前后都有空行：与前段、后段均隔断。
    expect(doc).toContain('前段。\n\n|  |  |\n| --- | --- |');
    expect(doc).toContain('|  |  |\n\n后段。');
    expect(tableCount(view)).toBe(1);
  });

  it('空文档插入：无多余前后空行（光标落首表头格）', () => {
    mount('', 0);
    table(view);
    expect(view.state.doc.toString()).toBe('|  |  |\n| --- | --- |\n|  |  |\n');
    expect(view.state.selection.main.head).toBe(2);
  });
});

describe('runMarkdownCommand 仅 markdown 家族文档执行（非 markdown no-op）', () => {
  afterEach(() => {
    setView(null);
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it('activeRenderMode 非 null（markdown/richtext）→ 执行变换', () => {
    mount('word', 0, 4);
    setView(view);
    useEditorStore.getState().setActiveRenderMode('live');
    expect(isMarkdownFamily()).toBe(true);
    runMarkdownCommand(bold);
    expect(view.state.doc.toString()).toBe('**word**');
  });

  it('activeRenderMode = null（非 markdown，如 .py）→ 静默不改文档', () => {
    mount('print(1)', 0, 8);
    setView(view);
    useEditorStore.getState().setActiveRenderMode(null);
    expect(isMarkdownFamily()).toBe(false);
    runMarkdownCommand(bold);
    expect(view.state.doc.toString()).toBe('print(1)');
  });
});
