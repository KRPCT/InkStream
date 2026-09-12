import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, expect, it } from 'vitest';
import { compareFullText } from '../diff/compareText';
import { createComparisonView, locateComparison, uniqueComparisonRange } from './comparisonView';
import { getView, setView } from './viewHandle';

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.destroy()); setView(null); });

it('只读完整正文不注册主编辑器，任何编辑transaction都被拒绝但选择仍可移动', () => {
  const main = new EditorView({ state: EditorState.create({ doc: '用户尚未保存的正文' }) });
  views.push(main); setView(main);
  const comparison = createComparisonView(document.createElement('div'), '完整\n\n正文\n结尾', [], 'new', '目标正文');
  views.push(comparison);
  expect(comparison.state.doc.toString()).toBe('完整\n\n正文\n结尾');
  expect(comparison.state.readOnly).toBe(true);
  expect(comparison.contentDOM.getAttribute('contenteditable')).toBe('false');
  comparison.dispatch({ changes: { from: 0, insert: '不能写入' } });
  comparison.dispatch({ selection: EditorSelection.cursor(3) });
  expect(comparison.state.doc.toString()).toBe('完整\n\n正文\n结尾');
  expect(comparison.state.selection.main.head).toBe(3);
  expect(getView()).toBe(main);
  expect(main.state.doc.toString()).toBe('用户尚未保存的正文');
});

it('真实 EditorState 的 CRLF 后高亮与定位使用同一坐标', () => {
  const source = '开头。\r\n\r\n中文新句。\r\n结尾。';
  const diff = compareFullText(source.replace('新', '旧'), source);
  const comparison = createComparisonView(document.createElement('div'), source, diff.newRanges, 'new', '目标正文');
  views.push(comparison);
  const range = diff.newRanges[0];
  locateComparison(comparison, range);
  expect(comparison.state.sliceDoc(comparison.state.selection.main.from, comparison.state.selection.main.to).trim()).toBe('中文新句。');
  expect(comparison.state.doc.toString()).toBe('开头。\n\n中文新句。\n结尾。');
});

it('重复或不在提交里的编辑文本不能假装有唯一定位', () => {
  expect(uniqueComparisonRange('甲。甲。', '甲。')).toBeNull();
  expect(uniqueComparisonRange('甲。', '未提交。')).toBeNull();
  expect(uniqueComparisonRange('头。\r\n目标。', '目标。')).toEqual({ from: 3, to: 6 });
});
