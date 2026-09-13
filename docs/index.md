# InkStream 功能文档

开发与验收的当前状态见 [CURRENT-STATE](CURRENT-STATE.md)；领域词汇见 [CONTEXT](../CONTEXT.md)，本轮多栏工作见 [执行计划](EXECUTION-PLAN.md)。

InkStream（墨流）各功能的使用指南。每篇都从用户视角讲怎么用：打开方式、操作步骤、快捷键和注意事项。

> 下载安装与项目概览见 [仓库 README](../README.md)。

## 编辑基础

- [编辑器与实时预览](./editor.md)：单内核、Source ↔ Live Preview 切换（Ctrl+E）、光标行展开、richtext 工具栏
- [三模式与工作区](./modes.md)：Standard / Academic / Creative 切换、打开文件夹、文件树 CRUD、非工作区文件、自动保存
- [项目与恢复](./projects.md)：本机项目档案、每项目会话、独立草稿、备份恢复与材质设置
- [快捷键与命令面板](./shortcuts.md)：Ctrl+Shift+P 命令面板、快捷键表、F11 Focus Mode
- [简易模式](./simple-mode.md)：精简界面与高级功能开关
- [导入主题](./themes.md)：本地 CSS 预览、兼容报告、应用与恢复内置主题

## 写作能力

- [数学公式块](./math.md)：math (KaTeX) / typst / latex (MathJax)、`/` 触发器、行内与块公式
- [公式编号与引用](./equations.md)：稳定标签、文内跳转、导出编号与 LaTeX 公式 PDF 片段
- [双向链接与知识网络](./links.md)：`[[wiki-link]]` 语法、`[[` 补全与跳转、反链面板、全库索引、Ctrl+P 快速打开
- [知识图谱](./graph.md)：Ctrl+G 全库 Graph View、邻域高亮、局部图谱
- [学术模式与 Zotero](./academic.md)：CAYW 插入引用、Citation Panel、参考文献（GB/T 7714 / APA / Vancouver）、Zotero 同步
- [创作模式](./creative.md)：章节-场景树、Codex 角色卡、Focus Mode、今日字数目标、场景概要
- [打字机 / 专注 / 写作 HUD](./writing.md)：光标行居中、淡化非光标段落、码字速度 / 时间 / 番茄钟悬浮窗

## 导出与阅读

- [文件导出](./export.md)：导出当前文档为 HTML / PDF / DOCX（系统装 pandoc 后再加 ODT/RTF/LaTeX/EPUB/Typst/Org）、可定制水印、数学与链接处理
- [阅读模式](./reading.md)：txt / Markdown / docx / epub / pdf 阅读、目录与书签、续读和可选书架

## 版本与协作

- [Git 版本管理](./git.md)：克隆入口、git-graph 三栏、提交 / 分支 / 本地变基 / stash 管理、远程同步与 SSH 签名
- [Prose Diff 与合并冲突](./diff-merge.md)：句级语义 diff、prose 三向合并解决器
- [GitHub 集成](./github.md)：PAT / gh CLI 登录、Issue / PR / review、内嵌 diff 审阅
- [自动更新](./update.md)：启动静默检查、下载后重启升级、签名验签、手动检查更新

## 验收与维护

- [BDD 自动化绑定状态](./specs/AUTOMATION.md)：人工映射 Vitest、CI / Rust 执行范围和仍开放的验证事项
- [工作台验收清单](../specs/01-workbench.spec.md)：当前 2.1 工作台行为及自动、真机验证分工
- [中文 IME 真机回归清单](../specs/03-live-preview-ime.spec.md)：物理输入法矩阵，自动桩与发布结果不能代替签核

---

← 返回 [README](../README.md)

2.1.0 多栏工作台的已实现行为、测试与真实窗口观察见 [ComputerUse 验收记录](WORKBENCH-ACCEPTANCE.md)。
