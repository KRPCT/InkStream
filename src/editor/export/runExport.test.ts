import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { withWatermark } from './runExport';

beforeEach(() => {
  useSettingsStore.setState({ exportBrandingFooter: true, exportBrandingText: 'Made with InkStream' });
});

describe('withWatermark（pandoc 水印）', () => {
  it('页脚关闭或文字空白时不追加', () => {
    useSettingsStore.setState({ exportBrandingFooter: false });
    expect(withWatermark('doc')).toBe('doc');
    useSettingsStore.setState({ exportBrandingFooter: true, exportBrandingText: '   ' });
    expect(withWatermark('doc')).toBe('doc');
  });

  it('开启时追加分隔线 + 斜体水印', () => {
    expect(withWatermark('doc')).toBe('doc\n\n---\n\n*Made with InkStream*\n');
  });

  it('转义 markdown 元字符 + 去换行（水印作字面文本，不改文档结构）', () => {
    useSettingsStore.setState({ exportBrandingText: '# 标题\n---*强*' });
    const out = withWatermark('doc');
    expect(out).toContain('\\# 标题 \\-\\-\\-\\*强\\*');
    expect(out).not.toMatch(/\n# 标题/);
  });
});
