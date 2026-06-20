# InkStream 功能文档

InkStream（墨流）各功能的使用指南。每篇都是用户视角的「怎么用」——打开方式、操作步骤、快捷键与注意事项。

> 下载安装与项目概览见 [仓库 README](../README.md)。

## 编辑基础

- [编辑器与实时预览](./editor.md) — 单内核、Source ↔ Live Preview 切换（Ctrl+E）、光标行展开、richtext 工具栏
- [三模式与工作区](./modes.md) — Standard / Academic / Creative 切换、打开文件夹、文件树 CRUD、非工作区文件、自动保存
- [快捷键与命令面板](./shortcuts.md) — Ctrl+Shift+P 命令面板、完整快捷键表、F11 Focus Mode
- [简易模式](./simple-mode.md) — 轻度用户精简界面、关闭全部高级功能、不创建 .inkstream 索引库

## 写作能力

- [数学公式块](./math.md) — math (KaTeX) / typst / latex (MathJax)、`/` 触发器、行内与块公式
- [双向链接与知识网络](./links.md) — `[[wiki-link]]` 全语法、`[[` 补全与跳转、反链面板、全库索引、Ctrl+P 快速打开
- [知识图谱](./graph.md) — Ctrl+G 全库 Graph View、邻域高亮、局部图谱
- [学术模式与 Zotero](./academic.md) — CAYW 插入引用、Citation Panel、参考文献（GB/T 7714 / APA / Vancouver）、Zotero 同步
- [创作模式](./creative.md) — 章节-场景树、Codex 角色卡、Focus Mode、今日字数目标、场景概要
- [打字机 / 专注 / 写作 HUD](./writing.md) — 光标行居中、淡化非光标段落、码字速度 / 时间 / 番茄钟悬浮窗

## 导出与阅读

- [文件导出](./export.md) — 导出当前文档为 HTML / PDF / DOCX（系统装 pandoc 再加 ODT/RTF/LaTeX/EPUB/Typst/Org）、可定制水印、数学与链接处理
- [阅读模式](./reading.md) — txt / docx / epub / pdf 沉浸阅读、小说 vs 文献自动识别、亮 / 护眼 / 夜间配色

## 版本与协作

- [Git 版本管理](./git.md) — git-graph 三栏、提交 / 分支 / 合并 / stash、远程同步、SSH 签名
- [Prose Diff 与合并冲突](./diff-merge.md) — 句级语义 diff、prose 三向合并解决器
- [GitHub 集成](./github.md) — PAT / gh CLI 登录、Issue / PR / review、内嵌 diff 审阅
- [自动更新](./update.md) — 启动静默检查、一键下载并重启升级、签名验签、手动检查更新

---

← 返回 [README](../README.md)
