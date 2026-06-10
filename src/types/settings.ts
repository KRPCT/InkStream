import type { ModeLayout } from './workbench';

/** 主题三态设置（D-13）：用户可锁定亮/暗，或跟随系统。 */
export type ThemeSetting = 'light' | 'dark' | 'system';

/** 实际生效的主题（system 解析后的落点），驱动 <html data-theme>。 */
export type ResolvedTheme = 'light' | 'dark';

/** 三模式（布局预设 + 功能集，Plan 03/05 消费），驱动 <html data-mode>。 */
export type AppMode = 'standard' | 'academic' | 'creative';

/**
 * settings.json 磁盘契约（01-RESEARCH.md Pattern 6 形状，D-11）。
 * 真相源：tauri-plugin-store 落盘；localStorage 'inkstream.boot' 仅为首帧镜像。
 */
export interface PersistedSettings {
  version: 1;
  theme: ThemeSetting;
  mode: AppMode;
  layouts: Record<AppMode, ModeLayout>;
  commandMru: string[];
}
