import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { useCodexStore } from '../../stores/useCodexStore';
import type { CodexEntry } from '../../types/creative';
import { CODEX_TYPE_LABEL } from '../codex';
import { isComposing, refreshLivePreview } from '../composition';

/**
 * Codex 提及高亮 + 悬停卡（CREA-02）。复用 Phase-3 行内装饰范式：
 * - **非 atomic** `Decoration.mark`（仅加 class、不裂文本节点、不 replace/widget）→ 光标/选区/IME 全程不受扰；
 * - update() **逐字复制** inlinePlugin 的 IME 冻结契约（refreshed-first → 组合期短路 map-not-rebuild）；
 * - 悬停卡走 hoverTooltip（指针驱动、不程序化抢焦点 → 不触 WebView2 TSF 武装规则）+ createElement/textContent（无 innerHTML）。
 * 触发词 = name + aliases。匹配边界规则：拉丁名遵词边界（John 不命中 Johnson），CJK 名按子串命中——
 * 连续中文无词间空格，若按 \p{L} 边界判定会漏掉几乎所有真实提及（如「林深走来」的「走」也是 \p{L}）；
 * 故仅拉丁字母/数字作「词内」阻断，接受「林深」命中「林深远」内部的少见过命中（longest-first 让同存的更长条目优先）。
 * 条目源 useCodexStore（vault 全局）；条目变更由 editor/codex.refreshCodex 派发 refreshLivePreview 触发重建。
 */

const mentionMark = Decoration.mark({ class: 'cm-ink-codex' });
const LATIN_WORD = /[A-Za-z0-9]/; // 仅拉丁字母/数字阻断（CJK 无词间空格，按 \p{L} 边界会漏真实提及）

function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || !LATIN_WORD.test(ch);
}

// 触发词表按条目引用 memoize（避免每次重建都重排）。
let cachedEntries: CodexEntry[] | null = null;
let cachedTriggers: { trigger: string; entry: CodexEntry }[] = [];
function triggers(): { trigger: string; entry: CodexEntry }[] {
  const entries = useCodexStore.getState().entries;
  if (entries === cachedEntries) return cachedTriggers;
  const list: { trigger: string; entry: CodexEntry }[] = [];
  for (const e of entries) {
    for (const t of [e.name, ...e.aliases]) if (t) list.push({ trigger: t, entry: e });
  }
  list.sort((a, b) => b.trigger.length - a.trigger.length); // longest-first：长触发词优先，避免短别名先命中
  cachedEntries = entries;
  cachedTriggers = list;
  return list;
}

/** 仅可视区扫描，最长优先 + 词边界校验，逐段构建 mark。 */
function build(view: EditorView): DecorationSet {
  const list = triggers();
  const builder = new RangeSetBuilder<Decoration>();
  if (list.length === 0) return builder.finish();
  const { state } = view;
  const docLen = state.doc.length;
  for (const { from, to } of view.visibleRanges) {
    const text = state.sliceDoc(from, to);
    let i = 0;
    while (i < text.length) {
      let step = 1;
      for (const { trigger } of list) {
        if (text.startsWith(trigger, i)) {
          const before = i > 0 ? text[i - 1] : from > 0 ? state.sliceDoc(from - 1, from) : undefined;
          const afterIdx = i + trigger.length;
          const after =
            afterIdx < text.length
              ? text[afterIdx]
              : to < docLen
                ? state.sliceDoc(to, to + 1)
                : undefined;
          if (isBoundary(before) && isBoundary(after)) {
            builder.add(from + i, from + i + trigger.length, mentionMark);
            step = trigger.length;
            break;
          }
        }
      }
      i += step;
    }
  }
  return builder.finish();
}

class CodexMentionPluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = build(view);
  }

  update(u: ViewUpdate): void {
    // 逐字复制 inlinePlugin 契约（铁律）：refreshLivePreview 强刷先于 IME 短路判定。
    const refreshed = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLivePreview)));
    // 组合期绝不重建（撕合成文本节点 = 吞字）；docChanged 时 map 旧集跟随位移。
    if (!refreshed && isComposing(u.view)) {
      if (u.docChanged) this.decorations = this.decorations.map(u.changes);
      return;
    }
    if (u.docChanged || u.viewportChanged || u.selectionSet || refreshed) {
      this.decorations = build(u.view);
    }
  }
}

export const codexMentionPlugin = ViewPlugin.fromClass(CodexMentionPluginValue, {
  decorations: (v) => v.decorations,
});

/** 悬停卡 DOM（createElement + textContent，禁 innerHTML，XSS 防护）。 */
function buildCard(entry: CodexEntry): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cm-ink-codex-card';
  const head = document.createElement('div');
  head.className = 'cm-ink-codex-card-head';
  const name = document.createElement('span');
  name.className = 'cm-ink-codex-card-name';
  name.textContent = entry.name;
  const type = document.createElement('span');
  type.className = 'cm-ink-codex-card-type';
  type.textContent = CODEX_TYPE_LABEL[entry.type];
  head.append(name, type);
  card.appendChild(head);
  if (entry.summary) {
    const summary = document.createElement('div');
    summary.className = 'cm-ink-codex-card-summary';
    summary.textContent = entry.summary;
    card.appendChild(summary);
  }
  return card;
}

/** 指针悬停命中提及 → 显示卡片。独立于装饰再匹配一次（简单可靠）。 */
export const codexHoverTooltip = hoverTooltip((view, pos) => {
  const list = triggers();
  if (list.length === 0) return null;
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const rel = pos - line.from;
  for (const { trigger, entry } of list) {
    let idx = text.indexOf(trigger);
    while (idx !== -1) {
      const end = idx + trigger.length;
      if (rel >= idx && rel <= end) {
        const before = idx > 0 ? text[idx - 1] : undefined;
        const after = end < text.length ? text[end] : undefined;
        if (isBoundary(before) && isBoundary(after)) {
          return {
            pos: line.from + idx,
            end: line.from + end,
            above: true,
            create: () => ({ dom: buildCard(entry) }),
          };
        }
      }
      idx = text.indexOf(trigger, idx + 1);
    }
  }
  return null;
});

export const codexMentionTheme = EditorView.baseTheme({
  '.cm-ink-codex': {
    textDecoration: 'underline dotted',
    textDecorationColor: 'var(--cm-codex-mention)',
    textUnderlineOffset: '2px',
    cursor: 'help',
  },
  '.cm-ink-codex-card': {
    maxWidth: '280px',
    padding: '6px 8px',
    font: '13px/1.4 inherit',
  },
  '.cm-ink-codex-card-head': { display: 'flex', alignItems: 'center', gap: '6px' },
  '.cm-ink-codex-card-name': { fontWeight: '600', color: 'var(--text-normal)' },
  '.cm-ink-codex-card-type': {
    fontSize: '11px',
    color: 'var(--text-muted)',
    border: '1px solid var(--background-modifier-border)',
    borderRadius: '3px',
    padding: '0 4px',
  },
  '.cm-ink-codex-card-summary': { marginTop: '4px', color: 'var(--text-muted)' },
});

/** Codex 提及扩展集（挂入 livePreviewExtensions）。 */
export const codexMentionExtensions = [codexMentionPlugin, codexHoverTooltip, codexMentionTheme];
