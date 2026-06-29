/**
 * 应用内更新公告（What's New）数据源。每次发版在此**追加一条**（最新在前）。
 *
 * 设计：公告内容随应用打包（不依赖 release 工作流注入），故「发版后首启」与「更新重启后首启」都靠
 * 「当前版本 !== 已见版本」触发展示（useWhatsNewStore.showFor），无需改动 .github/workflows。
 * level 决定是否放恭喜动效（major/minor 放，patch 不放）。
 */
export type ChangeLevel = 'major' | 'minor' | 'patch';

export interface ChangelogEntry {
  /** 版本号（与 tauri.conf.json / package.json 同步）。 */
  version: string;
  /** 发布日期 YYYY-MM-DD。 */
  date: string;
  /** 公告标题。 */
  title: string;
  /** 版本级别：major/minor 触发恭喜动效，patch 仅静态展示。 */
  level: ChangeLevel;
  /** 要点列表（纯文本，逐条展示；不渲染 markdown，杜绝 XSS 面）。 */
  highlights: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '1.2.1',
    date: '2026-06-29',
    title: 'v1.2.1 · 粘贴修复 / 界面缩放 / Markdown 阅读',
    level: 'patch',
    highlights: [
      '修复：右键菜单「粘贴」现可粘入从其它应用复制的文本（此前仅 Ctrl+V 可用）',
      '界面缩放：Ctrl+= 放大 / Ctrl+- 缩小 / Ctrl+0 重置，或在「设置 ▸ 外观 ▸ 界面缩放」中调整（50%–300%）',
      'Markdown 阅读模式：.md 文件可经命令面板「视图：阅读模式」进入沉浸式排版阅读',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-06-26',
    title: 'v1.2 · 更新公告 / 内置终端 / 全库搜索替换',
    level: 'minor',
    highlights: [
      '更新公告：发版与更新重启后自动展示本页，重大更新还会有恭喜动效',
      '内置终端：编辑区底部可拖拽终端面板，直接在工作区目录启动 shell（设置中开启，Ctrl+` 唤起）',
      '全库搜索替换：Ctrl+Shift+F 跨文件查找，命中结果可逐条行内编辑，或一键全库替换',
      '命令面板升级：输入 # 触发全库全文搜索，输入 @ 跳转当前文档的标题',
      '面包屑导航栏：实时显示光标所在的标题层级，与大纲、编辑器光标双向联动',
      '大纲拖拽重排：在大纲面板拖动标题即可整节（含其下子节）移动重排章节',
      '导出：文档引用的本地图片现已真正嵌入 HTML / PDF / DOCX',
      '简易模式：退出不再催 git 提交，但会提醒未保存的文档',
    ],
  },
];

/** 某版本对应的公告条目（无则 undefined）。 */
export function changelogFor(version: string): ChangelogEntry | undefined {
  return CHANGELOG.find((e) => e.version === version);
}
