import { useRef, useState, type CSSProperties } from 'react';
import { inspectImportedTheme } from '../../styles/themeImport';
import { applyCustomTheme, useImportedThemeStore } from '../../stores/useImportedThemeStore';
import type { ThemePreview } from '../../types/importedTheme';

export default function ImportedThemeSection() {
  const current = useImportedThemeStore((state) => state.current);
  const busy = useImportedThemeStore((state) => state.busy);
  const [preview, setPreview] = useState<ThemePreview | null>(null);
  const [error, setError] = useState('');
  const request = useRef(0);
  const read = async (file: File | undefined) => {
    if (!file) return;
    const token = ++request.current;
    setError('');
    try {
      if (file.size > 1_048_576 || !file.name.toLowerCase().endsWith('.css')) throw new Error('请选择不超过 1 MiB 的 theme.css 文件。');
      const css = await file.text();
      if (token !== request.current) return;
      setPreview(inspectImportedTheme({ version: 1, name: file.name.replace(/\.css$/i, '').slice(0, 100), css }));
    } catch (error) { if (token === request.current) setError(error instanceof Error ? error.message : String(error)); }
  };
  const apply = async (value: ThemePreview | null) => {
    setError('');
    try { await applyCustomTheme(value); setPreview(null); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <section className="border-b border-[var(--background-modifier-border)] py-3 text-[13px]">
    <div className="mb-1 text-[var(--text-normal)]">导入 Obsidian 主题{current ? ` · ${current.source.name}` : ''}</div>
    <p className="mb-3 text-[12px] text-[var(--text-muted)]">支持通用颜色、语法颜色和本机字体；专用界面布局、插件样式和外部资源不在兼容范围内。导入后先预览，可随时恢复内置主题。</p>
    <input aria-label="导入 Obsidian 主题" type="file" accept=".css,text/css" disabled={busy} onChange={(event) => { void read(event.target.files?.[0]); event.target.value = ''; }} className="max-w-full text-[12px]" />
    {current && <button type="button" disabled={busy} onClick={() => void apply(null)} className="ml-2 rounded border px-2 py-1">恢复内置主题</button>}
    {preview && <div className="mt-3 space-y-2">
      <p>主题预览：{preview.source.name}</p>
      <div className="grid grid-cols-2 gap-2">{(['light', 'dark'] as const).map((mode) => <div key={mode} data-theme-preview={mode} style={preview[mode] as CSSProperties} className="rounded border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-3 text-[var(--text-normal)]">
        <strong>{mode === 'light' ? '亮色' : '暗色'} · InkStream</strong><p className="mt-1 text-[var(--text-muted)]">让文字保持清晰。</p><code className="text-[var(--cm-keyword)]">const story = '开始';</code>
      </div>)}</div>
      <p className="text-[12px] text-[var(--text-muted)]">已识别 {preview.appliedCount} 项颜色与字体映射，跳过 {preview.skipped.length} 条不兼容规则。</p>
      {preview.skipped.length > 0 && <details><summary className="cursor-pointer text-[12px]">查看兼容报告</summary><ul className="max-h-32 overflow-auto text-[11px]">{preview.skipped.map((item) => <li key={item}>{item}</li>)}</ul></details>}
      <div className="flex gap-3"><button type="button" disabled={busy} onClick={() => void apply(preview)} className="rounded border px-2 py-1">{busy ? '正在保存…' : '应用主题'}</button><button type="button" disabled={busy} onClick={() => { ++request.current; setPreview(null); }}>取消预览</button></div>
    </div>}
    {error && <p role="alert" className="mt-2 text-[12px] text-[var(--color-error)]">{error}</p>}
  </section>;
}
