export interface ImportedTheme { version: 1; name: string; css: string }
export interface ThemePreview {
  source: ImportedTheme;
  light: Record<string, string>;
  dark: Record<string, string>;
  appliedCount: number;
  skipped: string[];
}
