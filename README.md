# InkStream / 墨流

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CodeMirror](https://img.shields.io/badge/CodeMirror-6-d30707)](https://codemirror.net/)
[![Status](https://img.shields.io/badge/status-alpha-orange)](#当前状态)

**文本编辑器中的 IntelliJ** —— 单内核、三模式、git 原生的桌面写作应用。

一个 App 写论文、写小说、写文档：内置 Zotero 引用、Obsidian 式双向链接、Typst/LaTeX/KaTeX 数学排版、完整 git 图谱与句级 prose diff，不需要拼装任何插件。

---

## 目录

- [它为谁而做](#它为谁而做)
- [三模式](#三模式)
- [核心特性](#核心特性)
- [当前状态](#当前状态)
- [技术栈](#技术栈)
- [开发指引](#开发指引)
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
- **GitHub 集成**：PAT / gh CLI 登录（token 存 OS 凭据库、不进前端）、Issue 与 PR 浏览 / 评论 / 创建、PR review 与内嵌 diff 审阅（经 Rust 直连 GitHub REST）
- **中文优先**：中文 IME 输入全程不被渲染打断、中英混合字数统计、中文模糊搜索

## 当前状态

状态：alpha。Phase 1-11 交付（核心编辑 / 知识网络 / 数学 / git / 学术 / 创作 / 图谱可视化 / GitHub 集成），Phase 12（prose 三向合并与发布工程）进行中。已交付能力：

- 五插槽工作台：TitleBar / Sidebar / EditorArea / RightPanel / StatusBar，面板宽度可拖拽并按模式记忆
- 三模式运行时切换：Standard / Academic / Creative 布局预设与强调色即时变化，不重建窗口、不丢内容
- 主题系统：亮色 / 暗色 / 跟随系统三态，CSS 变量分层（Obsidian 命名习惯，Atom one-dark/one-light 取值），6 组合 WCAG 对比度单测看护，启动无主题闪烁
- 命令面板与命令注册表：Ctrl+Shift+P 打开，中文模糊搜索，MRU 置顶，中文 IME 组合输入防御（组合中快捷键与 Enter 不误触发）
- Windows 自绘标题栏：拖拽 / 双击最大化还原 / 窗口控制按钮，嵌入式文字菜单
- 工作区与文件：打开文件夹（按 git 仓库根）、文件树新建 / 重命名 / 删除 / 拖拽（删除走系统回收站）、外部修改提示重载绝不静默覆盖、Ctrl+P 中文模糊快速打开
- 单一 CodeMirror 6 内核：全 App 唯一编辑器实例，任何时刻纯文本是文档真相源；Markdown / LaTeX / Typst / JS / TS / Python / Rust / JSON / YAML / HTML / CSS / Shell 语法高亮；frontmatter `language:` 整体切换；richtext 简化工具栏（物理保存仍为 Markdown）
- Live Preview 装饰层：Source / Live Preview 运行时切换（命令 / Ctrl+E / 状态栏），标题 / 加粗 / 列表 / 链接 / 表格 / 图片 / 任务复选框渲染为最终样式，光标所在行自动展开源码；十万字文档装饰构建低于一帧
- 统一 IME 冻结门：中文输入法组合期内换装 / 重载 / 落盘 / 装饰刷新单点排队收口，组合输入不被任何重算打断（全渲染模式、全语言在册）
- 知识网络（Phase 4）：SQLite FTS5 全库索引（中文 trigram 分词，Rust 端单写队列）；`[[wiki-link]]` 完整语法（`|alias` / `#heading` / `^block`）自研解析与 Live Preview 渲染，`[[` 模糊补全 / Ctrl 点击跳转 / 不存在即建，反链面板含 unlinked mentions
- 数学排版（Phase 5）：三类 fenced 原语就地渲染——```math（KaTeX）/ ```typst（typst.ts wasm Worker → SVG）/ ```latex（MathJax SVG），全部懒加载
- Git 与协作（Phase 6-7）：Rust libgit2 完整命令集（含远程 clone / fetch / push / pull，SSH 经 git CLI）、自绘 SVG 三栏 git-graph、右键菜单驱动、GitHub PR 流程；prose-aware 中英混合句级语义 diff
- 学术模式（Phase 8）：Zotero CAYW 插入 `[@citekey]`、Web API 增量同步 + 离线缓存、Citation Panel（未解析标红）、参考文献编译期展开（GB/T 7714 / APA / Vancouver）、引用↔Typst/LaTeX 联动
- 创作模式（Phase 9）：文件夹即章 / 文件即场景的导航树（状态色点 + 场景字数）、固定 `Codex/` 角色·地点·设定卡（别名提及高亮 + 悬停卡）、Focus Mode（F11 段落聚焦）、今日字数目标进度、场景概要卡
- 知识可视化（Phase 10）：Ctrl+G 全库 Graph View（d3-force 力导 + Canvas2D 自绘 + 布局 Worker 化 + 缩放 / 点击打开 / 邻域高亮 / 大图降级）、RightPanel 局部图谱 tab；Standard 三 tab（大纲 / 反链 / 局部图谱）与 StatusBar 完整态（文件路径 / 光标行列 / git 分支 / 字数 / 渲染模式）补齐
- GitHub 集成（Phase 11）：PAT / gh CLI 登录（token 留 OS 凭据库、绝不进前端）、Issue 浏览 / 评论 / 创建、PR 评论 / review（批准·请求修改·评论）/ 内嵌 diff 审阅；全经 Rust 直连 GitHub REST（绕 CORS、令牌不出 Rust）
- 非工作区文件：以独立 tab 打开且 git 排外、切库不误覆盖且原文件不丢，支持拖拽到应用 / 系统"打开方式"启动
- 自动保存：500ms 防抖原子写（temp 同目录 + fsync + rename），按路径串行写链，文件监听自激抑制
- 持久化：主题 / 模式 / 各模式布局 / 最近 vault / 文件树展开态重启原样恢复，损坏配置自动回落默认并提示，用户仓库零写入
- 三平台冒烟 CI：ubuntu / windows / macos 矩阵跑 typecheck / lint / test / build / cargo check；另有三平台发行版打包工作流（同时产出 Windows / macOS / Linux 安装包）
- ATDD 验收规范：[specs/](./specs/)（含中文 IME 真机手测矩阵——所有装饰类变更的永久回归门）

v1 范围外（明确不做）：实时多人协作、移动端、插件市场、内置 AI 写作、成为代码 IDE、复刻 Obsidian 插件 API。

## 技术栈

| 层 | 选型 |
|----|------|
| 桌面壳 | Tauri 2（Rust + Web，体积优先） |
| 前端 | React 19 + TypeScript strict |
| 状态 | Zustand 5 |
| 样式 | Tailwind 4（布局）+ 原生 CSS 变量（主题，Obsidian 命名习惯） |
| 编辑器内核 | CodeMirror 6 + @lezer/markdown（单实例单内核 + 三层装饰范式 + 统一 IME 冻结门） |
| 数学排版 | KaTeX / @myriaddreamin/typst.ts (wasm) / MathJax |
| Git | git2 (libgit2 Rust binding) |
| GitHub | Rust reqwest 直连 REST + keyring（PAT / gh CLI 登录，token 不进前端） |
| 全文索引 | SQLite FTS5（Rust 端单写入队列） |

## 开发指引

环境要求：

- Node 22（LTS）
- Rust stable 工具链（rustup）
- pnpm 11.5.2（经 corepack 激活，与 package.json 的 packageManager 字段一致）

```bash
corepack enable
pnpm install          # 安装依赖（精确版本锁定）
pnpm tauri dev        # 启动桌面应用（开发模式）
pnpm test             # Vitest 单元测试
pnpm typecheck        # TypeScript 类型检查
pnpm lint             # ESLint
pnpm build            # 类型检查 + 前端构建
```

Linux 构建需先安装 webkit2gtk 等系统依赖，清单见 [.github/workflows/ci.yml](./.github/workflows/ci.yml)。

构建发行版：

```bash
pnpm tauri build      # 打包本平台安装包，产物在 src-tauri/target/release/bundle/
```

三平台安装包（Windows `.msi` / `.exe`、macOS `.dmg`、Linux `.deb` / `.AppImage`）经 [.github/workflows/release.yml](./.github/workflows/release.yml) 在 CI 同时构建——手动 `workflow_dispatch` 产出可下载产物，推送 `v*` tag 则发布到对应 GitHub Release。当前 macOS / Windows 产物尚未代码签名。

## 开发标准

- TypeScript strict 强制；ESLint + Prettier；单文件不超过 200 行（编辑器扩展除外）
- 每个 CodeMirror 扩展配对 Vitest 单元测试；ATDD 验收规范随阶段交付（specs/）；Playwright E2E 随桌面壳成熟引入
- Conventional Commits；全部提交 SSH 签名（Verified）
- pnpm 精确版本锁定，提交 lockfile；CI 中 actions 按 commit SHA 锁定

---

*用一条墨线，流过论文、小说与代码。*
