import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
  insertLink,
  isUrl,
  richtextPasteHandler,
  toggleBold,
  toggleItalic,
  wrapUnderline,
} from './commands';

let view: EditorView;

function mount(doc: string, anchor: number, head: number = anchor): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
    }),
  });
  return view;
}

/** 当前主选区选中的文本。 */
function selectedText(): string {
  const r = view.state.selection.main;
  return view.state.doc.sliceString(r.from, r.to);
}

afterEach(() => {
  view?.destroy();
});

describe('toggleBold', () => {
  it('有选区包 ** **', () => {
    mount('hello world', 6, 11);
    toggleBold(view);
    expect(view.state.doc.toString()).toBe('hello **world**');
  });

  it('无选区插 **** 且光标居中', () => {
    mount('', 0);
    toggleBold(view);
    expect(view.state.doc.toString()).toBe('****');
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe(2);
  });
});

describe('toggleItalic', () => {
  it('有选区包 * *', () => {
    mount('hello world', 0, 5);
    toggleItalic(view);
    expect(view.state.doc.toString()).toBe('*hello* world');
  });

  it('无选区插 ** 光标居中', () => {
    mount('', 0);
    toggleItalic(view);
    expect(view.state.doc.toString()).toBe('**');
    expect(view.state.selection.main.head).toBe(1);
  });
});

describe('wrapUnderline', () => {
  it('落盘 <u>选区</u>（D-15 物理 HTML）', () => {
    mount('keep this', 5, 9);
    wrapUnderline(view);
    expect(view.state.doc.toString()).toBe('keep <u>this</u>');
    expect(view.state.doc.toString()).toContain('<u>');
    expect(view.state.doc.toString()).toContain('</u>');
  });

  it('无选区插空 <u></u> 光标在标签间', () => {
    mount('', 0);
    wrapUnderline(view);
    expect(view.state.doc.toString()).toBe('<u></u>');
    expect(view.state.selection.main.head).toBe('<u>'.length);
  });
});

describe('insertLink', () => {
  it('有选区产生 [选区](url) 且光标选中 url 占位（D-16）', () => {
    mount('see docs', 4, 8);
    insertLink(view);
    expect(view.state.doc.toString()).toBe('see [docs](url)');
    // 光标选区落在 url 占位上，便于直接键入真实地址
    expect(selectedText()).toBe('url');
  });

  it('无选区插空模板 []() 光标置首', () => {
    mount('', 0);
    insertLink(view);
    expect(view.state.doc.toString()).toBe('[]()');
    expect(view.state.selection.main.head).toBe(1);
  });
});

describe('isUrl', () => {
  it('识别 http/https URL', () => {
    expect(isUrl('https://example.com')).toBe(true);
    expect(isUrl('http://a.b/c?d=1')).toBe(true);
    expect(isUrl('  https://trim.me  ')).toBe(true);
  });

  it('拒非 URL 文本', () => {
    expect(isUrl('just text')).toBe(false);
    expect(isUrl('not a link')).toBe(false);
    expect(isUrl('')).toBe(false);
    expect(isUrl('ftp://x')).toBe(false);
  });
});

describe('richtextPasteHandler 智能粘贴（D-16）', () => {
  function paste(text: string): { handled: boolean } {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const evt = new ClipboardEvent('paste', { clipboardData: dt, cancelable: true });
    richtextPasteHandler(evt, view);
    return { handled: evt.defaultPrevented };
  }

  it('剪贴板为 URL + 有选区 → 自动包成 [选区](URL)', () => {
    mount('go here', 3, 7);
    const { handled } = paste('https://example.com');
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe('go [here](https://example.com)');
  });

  it('剪贴板为 URL 但无选区 → 放行默认粘贴', () => {
    mount('', 0);
    const { handled } = paste('https://example.com');
    expect(handled).toBe(false);
    expect(view.state.doc.toString()).toBe('');
  });

  it('剪贴板非 URL → 放行默认粘贴', () => {
    mount('go here', 3, 7);
    const { handled } = paste('plain text');
    expect(handled).toBe(false);
    expect(view.state.doc.toString()).toBe('go here');
  });
});
