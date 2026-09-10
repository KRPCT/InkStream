import type { ImportedTheme, ThemePreview } from '../types/importedTheme';
type Mode = 'light' | 'dark';
const common = ['background-primary', 'background-primary-alt', 'background-secondary', 'background-secondary-alt',
  'background-modifier-border', 'background-modifier-hover', 'background-modifier-active', 'text-normal', 'text-muted', 'text-faint', 'text-on-accent'];
const colorMap: Record<string, string[]> = Object.fromEntries(common.map((name) => [`--${name}`, [`--${name}`]]));
Object.assign(colorMap, {
  '--code-background': ['--cm-code-block-bg', '--cm-inline-code-bg'], '--code-comment': ['--cm-comment'],
  '--code-keyword': ['--cm-keyword'], '--code-string': ['--cm-string'], '--code-value': ['--cm-number'],
  '--code-function': ['--cm-function'], '--code-operator': ['--cm-operator'], '--code-property': ['--cm-variable'],
  '--blockquote-border-color': ['--cm-blockquote-border'], '--blockquote-color': ['--cm-blockquote-fg'],
  '--table-border-color': ['--cm-table-border'], '--table-header-background': ['--cm-table-header-bg'],
  '--hr-color': ['--cm-hr'], '--link-color': ['--cm-link'], '--text-accent': ['--text-accent', '--cm-link'],
  '--color-accent': ['--accent'], '--interactive-accent': ['--accent'], '--text-error': ['--color-error'],
});
const fontMap: Record<string, string[]> = { '--font-text': ['--font-editor'], '--font-interface': ['--font-ui'], '--font-monospace': ['--font-mono'] };
const control = document.createElement('span').style;
interface Value { text: string; rank: number; order: number }

function selectorRank(selector: string, mode: Mode): number | null {
  const value = selector.trim();
  if (value.length > 200 || !/^(?:(?:html|body)|:root|\.theme-(?:light|dark))+$/.test(value)) return null;
  if (value.includes(`.theme-${mode === 'light' ? 'dark' : 'light'}`)) return null;
  return (value.match(/\.|:root/g)?.length ?? 0) * 10 + (/^(html|body)/.test(value) ? 1 : 0);
}

function resolveValue(value: string, variables: Map<string, Value>, stack: string[] = []): string | null {
  if (value.length > 4096 || stack.length > 24 || /[\\{};<>@]|url\s*\(|expression\s*\(/i.test(value)) return null;
  const start = /var\(/i.exec(value)?.index ?? -1;
  if (start < 0) return value;
  let depth = 1, end = start + 4, comma = -1;
  for (; end < value.length && depth; ++end) {
    const char = value[end];
    if (char === '(') ++depth;
    else if (char === ')') --depth;
    else if (char === ',' && depth === 1 && comma < 0) comma = end;
  }
  if (depth) return null;
  const name = value.slice(start + 4, comma < 0 ? end - 1 : comma).trim();
  if (!/^--[\w-]+$/.test(name) || stack.includes(name)) return null;
  const declared = variables.get(name)?.text;
  const fallback = comma < 0 ? null : value.slice(comma + 1, end - 1).trim();
  const replacement = declared === undefined ? fallback : resolveValue(declared, variables, [...stack, name]);
  if (replacement === null) return null;
  return resolveValue(value.slice(0, start) + replacement + value.slice(end), variables, stack);
}

/** Parse in an unadopted stylesheet; the imported sheet itself never enters the app document. */
export function inspectImportedTheme(source: ImportedTheme): ThemePreview {
  if (source.version !== 1 || !source.name.trim() || source.name.length > 100 || source.css.length > 1_048_576 || new TextEncoder().encode(source.css).byteLength > 1_048_576) throw new Error('主题为空、格式不正确或超过 1 MiB。');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(source.css); // Constructed sheets discard @import without fetching it.
  const variables: Record<Mode, Map<string, Value>> = { light: new Map(), dark: new Map() };
  const skipped = new Set<string>();
  let order = 0;
  const walk = (rules: CSSRuleList, allowed: Mode[], depth = 0): void => {
    if (depth > 8) { skipped.add('嵌套层数超过 8'); return; }
    for (const rule of rules) {
      ++order;
      if (rule.type === 4) {
        const media = rule as CSSMediaRule;
        const match = /^\(prefers-color-scheme:\s*(light|dark)\)$/.exec(media.conditionText);
        if (match) walk(media.cssRules, allowed.filter((mode) => mode === match[1]), depth + 1);
        else skipped.add(`媒体规则 ${media.conditionText.slice(0, 80)}`);
        continue;
      }
      if (rule.type !== 1) { skipped.add(rule.cssText.slice(0, 80)); continue; }
      const styleRule = rule as CSSStyleRule;
      let recognized = false;
      for (const mode of allowed) {
        const ranks = styleRule.selectorText.split(',').map((selector) => selectorRank(selector, mode)).filter((rank): rank is number => rank !== null);
        if (!ranks.length) continue;
        recognized = true;
        for (let index = 0; index < styleRule.style.length; ++index) {
          const key = styleRule.style.item(index);
          if (!/^--[\w-]+$/.test(key)) { skipped.add(`${styleRule.selectorText} 的 ${key}`); continue; }
          const rank = Math.max(...ranks) + (styleRule.style.getPropertyPriority(key) === 'important' ? 10_000 : 0);
          const previous = variables[mode].get(key);
          if (!previous || rank > previous.rank || (rank === previous.rank && order >= previous.order))
            variables[mode].set(key, { text: styleRule.style.getPropertyValue(key).trim(), rank, order });
        }
      }
      if (!recognized) skipped.add(styleRule.selectorText.slice(0, 100));
    }
  };
  walk(sheet.cssRules, ['light', 'dark']);
  const result: ThemePreview = { source, light: {}, dark: {}, appliedCount: 0, skipped: [] };
  for (const mode of ['light', 'dark'] as const) {
    for (const [name, targets] of Object.entries({ ...colorMap, ...fontMap })) {
      const value = variables[mode].get(name);
      if (!value) continue;
      const resolved = resolveValue(value.text, variables[mode]);
      const property = name in fontMap ? 'font-family' : 'color';
      control.cssText = '';
      if (resolved !== null) control.setProperty(property, resolved);
      if (!control.getPropertyValue(property)) { skipped.add(`${mode} 的 ${name} 值不兼容`); continue; }
      for (const target of targets) result[mode][target] = resolved!;
    }
  }
  result.appliedCount = Object.keys(result.light).length + Object.keys(result.dark).length;
  result.skipped = [...skipped];
  if (!result.appliedCount) throw new Error('未找到可导入的颜色或字体变量。支持 :root、body、.theme-light 和 .theme-dark 中的通用主题变量。');
  return result;
}

export function themeStylesheet(preview: ThemePreview): string {
  return (['light', 'dark'] as const).map((mode) => `html:root[data-theme="${mode}"] {${Object.entries(preview[mode]).map(([name, value]) => `${name}:${value};`).join('')}}`).join('\n');
}
