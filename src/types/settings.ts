import type { ModeLayout } from './workbench';

/** 主题三态设置（D-13）：用户可锁定亮/暗，或跟随系统。 */
export type ThemeSetting = 'light' | 'dark' | 'system';

/** 实际生效的主题（system 解析后的落点），驱动 <html data-theme>。 */
export type ResolvedTheme = 'light' | 'dark';

/** 三模式（布局预设 + 功能集，Plan 03/05 消费），驱动 <html data-mode>。 */
export type AppMode = 'standard' | 'academic' | 'creative';

/** git 远程方式（簇②设置，簇④接入行为）：仅本地 / SSH / GitHub OAuth(HTTPS) / 自定义 git 服务器。 */
export type GitRemoteMode = 'local' | 'ssh' | 'oauth' | 'custom';

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
  // ── 簇② 用户可调项 ──
  /** 自动保存开关（关则编辑不自动落盘，仍标脏、Ctrl+S 手动存）。 */
  autosaveEnabled: boolean;
  /** 自动保存防抖延迟（毫秒，200–5000）。 */
  autosaveDelayMs: number;
  /** 编辑器字体大小（px，10–28）。 */
  editorFontSize: number;
  /** 今日字数目标（字，0–100000；0=关闭 StatusBar 进度条，CREA-04）。 */
  dailyWordGoal: number;
  /** git 远程方式（簇④接入行为）。 */
  gitRemoteMode: GitRemoteMode;
  /** 自定义 git 服务器地址（gitRemoteMode='custom' 时用）。 */
  gitCustomServer: string;
  /** 简易模式（轻度用户）：关闭全部高级功能 + 不在工作区创建 .inkstream 索引库，仅留基础编辑。 */
  simpleMode: boolean;
  /** 文件导出时在产物末尾附水印页脚（默认关；元数据/生成器标识始终写入，不受此开关影响）。 */
  exportBrandingFooter: boolean;
  /** 导出水印文字（exportBrandingFooter 开时用）；默认「Made with InkStream」，可自定义；空白则不附页脚。 */
  exportBrandingText: string;
}
