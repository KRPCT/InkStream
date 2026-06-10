# InkStream / 墨流

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CodeMirror](https://img.shields.io/badge/CodeMirror-6-d30707)](https://codemirror.net/)
[![Status](https://img.shields.io/badge/status-pre--alpha-orange)](#开发状态)

**文本编辑器中的 IntelliJ** —— 单内核、三模式、git 原生的桌面写作应用。

一个 App 写论文、写小说、写文档：内置 Zotero 引用、Obsidian 式双向链接、Typst/LaTeX/KaTeX 数学排版、完整 git 图谱与句级 prose diff，不需要拼装任何插件。

---

## 目录

- [它为谁而做](#它为谁而做)
- [三模式](#三模式)
- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [开发状态](#开发状态)
- [开发标准](#开发标准)

## 它为谁而做

| 用户群 | 当前痛点 | InkStream 提供 |
|--------|----------|----------------|
| 研究者 / 学者 | LaTeX 陡峭、Word 失控、Markdown 无引用 | 内置 Zotero 引用、Typst/LaTeX 块、git 多稿、Prose Diff |
| 创作者（小说/剧本） | 章节靠新建文件、角色一致性靠回翻 | 章节导航、Codex 角色卡、Focus Mode、prose-aware 合并 |
| 知识工作者 | Obsidian 插件越加越乱 | wiki-link + Graph View 原生内置，无插件市场负担 |
| 写作开发者 | IDE 写文档体验劣 | CodeMirror 6 单内核，混合 Markdown 与多语言代码 |

**非目标用户**：纯代码 IDE 用户、纯 WYSIWYG 用户、不用 git 的人。

## 三模式

三模式 = UI 布局预设 + 默认功能集 + 状态栏指标。不限制文件内容、不绑定文件格式，随时切换不丢数据。

| 模式 | 定位 | 强调色 | 特色 |
|------|------|--------|------|
| Standard | 通用文本编辑 | 石墨灰 | 文件树、大纲/反链/Local Graph、Live Preview |
| Academic | 学术写作 | 学院深蓝 | Zotero 文献库、Citation Panel、Typst 预览、学术工具栏 |
| Creative | 长篇创作 | 朱砂红 | 章节导航树、Codex、Focus Mode、字数目标进度 |

## 核心特性

- **单内核编辑器**：全 App 一个 CodeMirror 6 实例，任何时刻纯文本是文档真相源；Source 与 Live Preview 运行时切换，光标所在行自动展开源码
- **三类数学原语**：```math (KaTeX) / ```typst (typst.ts wasm 实时 SVG) / ```latex (MathJax)，全部懒加载
- **Obsidian 式知识网络**：`[[wiki-link]]` 完整语法（`|alias` / `#heading` / `^block-id`）、SQLite FTS5 全库索引（中文分词）、反链面板（含 unlinked mentions）、全库 Graph View
- **git 原生**：Rust libgit2 完整命令集；三栏 git-graph（图谱 + 提交详情 + 文件 diff），右键菜单驱动全部操作
- **prose-aware diff**：中英混合句级分词与段落对齐，看到"哪句话改了"而非"哪行变了"；合并冲突提供三向解决器
- **Zotero 学术集成**：CAYW picker 一键插入 `[@citekey]`、离线文献缓存、GB/T 7714 / APA / Vancouver 参考文献
- **GitHub 集成**：Device Flow 登录、Issue/PR 浏览评论、PR diff 内嵌审阅
- **中文优先**：中文 IME 输入全程不被渲染打断、中英混合字数统计、中文模糊搜索

## 技术栈

| 层 | 选型 |
|----|------|
| 桌面壳 | Tauri 2（Rust + Web，体积优先） |
| 前端 | React 19 + TypeScript strict |
| 状态 | Zustand 5 |
| 样式 | Tailwind 4（布局）+ 原生 CSS 变量（主题，Obsidian 命名习惯） |
| 编辑器内核 | CodeMirror 6 + @lezer/markdown |
| 数学排版 | KaTeX / @myriaddreamin/typst.ts (wasm) / MathJax |
| Git | git2 (libgit2 Rust binding) |
| GitHub | @octokit/rest + Device Flow |
| 全文索引 | SQLite FTS5（Rust 端单写入队列） |

## 开发状态

项目处于 pre-alpha 规划完成阶段，v1 共 12 个开发阶段，详见 [ROADMAP.md](./ROADMAP.md)。

| 当前阶段 | 状态 |
|----------|------|
| Phase 1 应用骨架与三模式 Workbench | 未开始 |

v1 范围外（明确不做）：实时多人协作、移动端、插件市场、内置 AI 写作、成为代码 IDE、复刻 Obsidian 插件 API。

## 开发标准

- TypeScript strict 强制；ESLint + Prettier；单文件不超过 200 行（编辑器扩展除外）
- 每个 CodeMirror 扩展配对 Vitest 单元测试；Playwright E2E 随桌面壳成熟引入
- Conventional Commits；全部提交 SSH 签名（Verified）
- pnpm 精确版本锁定，提交 lockfile

---

*用一条墨线，流过论文、小说与代码。*
