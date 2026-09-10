import { describe, expect, it } from 'vitest';
import { inspectImportedTheme, themeStylesheet } from './themeImport';
const inspect = (css: string) => inspectImportedTheme({ version: 1, name: 'fixture', css });

describe('theme variable compatibility and isolation', () => {
  it('resolves shared and per-mode variables using specificity, source order and important priority', () => {
    const result = inspect(':root { --n: 24; --paper: #fafafa; --text-normal: rgb(var(--n) var(--n) var(--n)); --background-primary: var(--paper); } .theme-dark.theme-dark { --paper: #101010; } .theme-dark { --paper: #343434; } .theme-light { --paper: #ffefef !important; } .theme-light { --paper: #ffffee; }');
    expect(result.light['--background-primary']).toBe('#ffefef');
    expect(result.dark['--background-primary']).toBe('#101010');
    expect(result.light['--text-normal']).toBe('rgb(24 24 24)');
    expect(themeStylesheet(result)).toContain('html:root[data-theme="dark"]');
  });
  it('translates local fonts and syntax colors but does not adopt component rules or resource declarations', () => {
    const result = inspect('.theme-dark { --text-normal: #eee; --code-keyword: #aaff00; --font-text: "Local Font", sans-serif; --background-primary: url(https://example.invalid/a); } button { display:none } @font-face { font-family: Remote; src:url(https://example.invalid/font.woff2) }');
    expect(result.dark).toMatchObject({ '--text-normal': '#eee', '--cm-keyword': '#aaff00' });
    expect(result.dark['--font-editor']).toMatch(/"Local Font",\s*sans-serif/);
    expect(result.dark['--background-primary']).toBeUndefined();
    expect(result.skipped.some((entry) => entry.includes('button'))).toBe(true);
    expect(themeStylesheet(result)).not.toMatch(/url|example\.invalid|display\s*:/);
  });
  it('rejects cyclic values while preserving valid colors and supports mode media queries', () => {
    const result = inspect(':root { --a: var(--b); --b: var(--a); --background-primary: var(--a); --text-normal: #123456; } @media (prefers-color-scheme: dark) { body { --text-normal: #eeeeee; } }');
    expect(result.light['--background-primary']).toBeUndefined();
    // :root is more specific than body, even inside a mode media query.
    expect(result.dark['--text-normal']).toBe('#123456');
    expect(result.skipped).toContain('dark 的 --background-primary 值不兼容');
  });
  it('rejects malformed, incompatible and oversized styles without publishing anything', () => {
    expect(() => inspect('not css')).toThrow('未找到');
    expect(() => inspect('.sidebar { display: none }')).toThrow('未找到');
    expect(() => inspect('/*' + '甲'.repeat(400_000) + '*/')).toThrow('1 MiB');
    expect(document.getElementById('inkstream-imported-theme')).toBeNull();
  });
});
