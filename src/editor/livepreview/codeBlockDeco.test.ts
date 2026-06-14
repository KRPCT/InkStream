import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { codeBlockDeco } from './codeBlockDeco';

/** 代码块底纹 + 语言角标行级装饰回归门（块编辑增强 W1 收尾）。 */

let view: EditorView | null = null;
afterEach(() => {
  destroyTestView(view);
  view = null;
});

function cbView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), codeBlockDeco]);
}
function lines(v: EditorView): Array<{ cls: string; lang?: string }> {
  const set = v.plugin(codeBlockDeco)?.decorations;
  const out: Array<{ cls: string; lang?: string }> = [];
  if (!set) return out;
  const iter = set.iter();
  while (iter.value) {
    const spec = iter.value.spec as { class?: string; attributes?: { 'data-lang'?: string } };
    out.push({ cls: spec.class ?? '', lang: spec.attributes?.['data-lang'] });
    iter.next();
  }
  return out;
}

describe('codeBlockDeco', () => {
  it('代码块每行加 cm-ink-codeblock，首/末行圆角，首行 data-lang', () => {
    view = cbView('正文\n\n```js\nconst x=1\n```');
    const ls = lines(view);
    expect(ls).toHaveLength(3); // ```js / const x=1 / ```
    expect(ls.every((l) => l.cls.includes('cm-ink-codeblock'))).toBe(true);
    expect(ls[0]?.cls).toContain('cm-ink-codeblock-first');
    expect(ls[0]?.lang).toBe('js');
    expect(ls[2]?.cls).toContain('cm-ink-codeblock-last');
  });

  it('math/latex/typst 块不加代码底纹（blockField 接管，正交）', () => {
    view = cbView('```math\nx^2\n```');
    expect(lines(view)).toHaveLength(0);
    destroyTestView(view);
    view = cbView('```typst\n= a\n```');
    expect(lines(view)).toHaveLength(0);
  });

  it('无 info 的 ``` 块也加底纹（无 data-lang 角标）', () => {
    view = cbView('```\nplain\n```');
    const ls = lines(view);
    expect(ls).toHaveLength(3);
    expect(ls[0]?.lang).toBeUndefined();
  });
});
