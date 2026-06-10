# InkStream / 墨流 — 产品需求文档 (PRD v0.2)

> 服从 [ORACLE.md](./ORACLE.md) v0.1。本文件以用户视角拆解 ORACLE 的承诺为可验证需求。
> 与 ORACLE 冲突时以 ORACLE 为准；与 [UI-SPEC.md](./UI-SPEC.md) 冲突时本文件优先。
>
> **v0.1 历史版本**：定位"Typora 继任者 + Obsidian 轻量替代品"，已归档至
> [archive/产品代号-typora-era.md](./archive/产品代号-typora-era.md)。本版本基于 ORACLE v0.1
> 重新定位为"文本编辑器中的 IntelliJ"。

- **代号**：InkStream / 墨流
- **PRD 版本**：v0.2 (Draft) | **日期**：2026-05-21

---

## 一、目标用户与核心痛点

| 用户群 | 当前痛点 | 现有工具组合 | InkStream 提供 |
|--------|----------|--------------|----------------|
| 研究者 / 学者 | LaTeX 学习曲线陡，Word 排版不可控，Markdown 无引用，多稿对比靠人脑 | Word + Zotero 或 Overleaf + Zotero + Git | 一个 App 写论文，内置 Zotero 引用、Typst/LaTeX 块、Git 多稿、Prose Diff 看差异 |
| 创作者（小说/剧本） | 章节切片靠新建文件，角色一致性靠回翻，多稿合并靠口算 | Scrivener / Word + Excel 人物卡 | Creative 模式：章节导航、Codex、Focus Mode、prose-aware 多稿合并 |
| 知识工作者 | Obsidian 用了 3 年，但插件越加越乱、上手有门槛 | Obsidian + 一堆社区插件 | Obsidian 原语（wiki-link + Graph View）内置，无插件市场负担，导入 Obsidian 主题即用 |
| 写作开发者 | 写文档夹代码示例时编辑器手感差，IDE 写文档体验劣 | VSCode + 一堆扩展 | CodeMirror 6 单内核，混合 Markdown + 多语言代码，git 原生 |

**非目标用户**：
- 纯代码 IDE 用户（应用 VSCode/Cursor）
- 纯 WYSIWYG Word 用户（应用 Word/Notion）
- 不用 git 的人（InkStream 不为"无版本管理"优化）

---

## 二、三模式需求边界（依据 ORACLE §4）

三模式 = UI 布局预设 + 默认启用功能集 + 状态栏指标。**不限制文件内容、不绑定文件格式**，可随时切换不丢数据。

### 2.1 Standard 模式 · 通用文本编辑器

| 维度 | 需求 |
|------|------|
| Sidebar | 工作区文件树（按 git 仓库根） |
| RightPanel | 大纲（Outline）/ 反链（Backlinks）/ 图谱（Local Graph）三 tab |
| Editor | Obsidian Markdown 渲染 + 三类 Fenced Block（math/typst/latex）+ 双向链接 |
| StatusBar | 文件路径、git 分支、字数、光标位置、Live Preview/Source 模式 |
| 强调色 | 石墨灰系（亮 `hsl(220, 10%, 50%)` / 暗 `hsl(220, 14%, 71%)`） |

**用户故事**：

- US-S1：我新建一个文件，默认 `.md`，能立刻输入 Markdown 并看到 Live Preview。
- US-S2：我输入 `[[` 时弹出 vault 文件 fuzzy 列表，选中后插入 `[[文件名]]`。
- US-S3：我 Ctrl+点击 `[[文件名]]` 跳转到目标文件，目标不存在时提示创建。
- US-S4：我打开 Backlinks 面板，看到当前文件被哪些文件 / 在哪个段落引用。
- US-S5：我用 `Ctrl+G` 打开全局 Graph View，看到 vault 的链接网络。

### 2.2 Academic 模式 · 学术写作

| 维度 | 需求 |
|------|------|
| Sidebar | 上半 Zotero 文献库（同步态显示），下半工作区文件树 |
| RightPanel | Citation Panel（引用条目）/ Typst 预览 / Outline 三 tab |
| Editor | Standard 全部 + 学术工具栏（引用 / 脚注 / 参考文献 / 公式编号） |
| StatusBar | 引用数 / 未解析引用警告 / Typst 编译状态 |
| 强调色 | 学院深蓝（亮 `hsl(220, 70%, 45%)` / 暗 `hsl(207, 82%, 66%)`） |

**用户故事**：

- US-A1：我按 `Ctrl+Shift+Z` 弹出 Zotero Better BibTeX picker，选中条目后光标处插入 `[@citekey]`。
- US-A2：我打开 Citation Panel，看到当前文档所有 `[@key]`，未解析的标红。
- US-A3：我在 `:::typst` 块里写公式，块右侧实时显示 typst.ts 编译的 SVG 预览。
- US-A4：我执行 `Insert Bibliography` 命令，文末插入 `<!-- biblio -->`，编译时展开为 GB/T 7714 / APA / Vancouver 格式。
- US-A5：我设置 Zotero Web API Key 后，离线时仍可看本地缓存的文献元数据。

### 2.3 Creative 模式 · 长篇创作

| 维度 | 需求 |
|------|------|
| Sidebar | 章节导航树（章 → 场景两级，含字数与状态色点） |
| RightPanel | Codex（角色 / 地点 / 设定）/ 场景概要 两 tab |
| Editor | Standard 全部 + 场景概要卡片（顶部可折叠）+ Focus Mode（非当前段落淡化）|
| StatusBar | 今日字数 / 目标进度条 / 章节场景计数 / 定稿色点 |
| 强调色 | 朱砂红（亮 `hsl(355, 65%, 50%)` / 暗 `hsl(355, 65%, 65%)`） |

**用户故事**：

- US-C1：我打开一个项目，左侧自动显示"章节导航树"，每个场景显示字数与定稿/已修/草稿色点。
- US-C2：我按 `F11` 进入 Focus Mode，非光标所在段落淡化。
- US-C3：我设置今日字数目标 2000，StatusBar 实时显示进度条。
- US-C4：我打开 Codex，添加一个新角色"阿楫"，在编辑器输入"阿楫"时自动高亮并悬停显示角色卡。
- US-C5：我在 git-graph 中对比两个 draft 分支，启用 Prose Diff，看到按句子级别的差异而非行差异。

---

## 三、编辑器内核需求（依据 ORACLE §6 / §7）

### 3.1 单内核

- 全 App 一个 CodeMirror 6 内核，不使用 Tiptap/ProseMirror。
- 任何时刻 `state.doc.toString()` 是文档真相源，所有 UI 渲染都基于 ViewPlugin/Decoration。

### 3.2 Source / Live Preview

- 两种渲染模式运行时切换（命令 + 状态栏指示）。
- Live Preview 把 Markdown 元素（标题、加粗、列表、链接、Fenced Block、wiki-link、citation）渲染为最终样式；光标所在行自动展开为源码。

### 3.3 多语言支持

- 内置：Markdown（Obsidian 变体）、LaTeX、Typst、JavaScript/TypeScript、Python、Rust、JSON、YAML、HTML、CSS、Shell。
- LSP 钩子留待 v2。

### 3.4 Fenced Block 三类原语

| 块类型 | 编译器 | 用户故事 |
|--------|--------|----------|
| ` ```math ` | KaTeX | US-F1：我打 `/math` 触发器插入数学块，块下实时渲染公式 |
| ` ```typst ` | `@myriaddreamin/typst.ts` wasm | US-F2：我在 typst 块写 `$ integral_0^1 x^2 d x $`，块右侧显示 SVG |
| ` ```latex ` | MathJax + 可选 tectonic 后端 | US-F3：我贴一段 LaTeX 公式，能 Live Preview，也可导出为 PDF 片段 |

### 3.5 默认文件格式

- 新建文件默认 `.md` + UTF-8。
- 可选 YAML frontmatter `language: markdown | latex | typst | richtext` 整体切语言。
- richtext = 简化 Markdown + 工具栏（B/I/U/链接），但物理存为 Markdown。

---

## 四、Git 原生需求（依据 ORACLE §8）

### 4.1 后端能力

Rust 端 `git2` (libgit2) 完整 commands，对前端暴露：
`git_status / git_branch_list / git_log / git_diff / git_commit / git_checkout / git_merge / git_rebase / git_cherry_pick / git_stash / git_tag / git_reset / git_clone / git_push / git_pull / git_fetch`。

### 4.2 前端 git-graph

- 复刻并增强 vscode-git-graph：图谱 + 提交详情 + 文件 diff 三栏。
- 右键菜单驱动所有操作（v0.4 v1，v0.8 全功能）。
- Find Widget、Filter Branches、Repository Settings。
- 与编辑器联动：点击 commit 自动在编辑器右侧打开 diff。
- 入口：菜单栏 View → Git Graph，快捷键 `Ctrl+Shift+G`。

### 4.3 GitHub 集成

- 登录 = Octokit Device Flow + 备用 PAT + 备用 `gh auth status`。
- Issue / PR 浏览、评论、创建。
- PR diff 内嵌编辑器，PR review 评论回复。

### 4.4 prose-aware diff

- 句级分词（中英文混合）→ 句级 LCS → 段落对齐 → 语义高亮。
- 合并冲突 prose-aware 三向解决器。

---

## 五、Obsidian 关系网络需求（依据 ORACLE §10）

- `[[wiki-link]]` 完整语法（含 `|alias`、`#heading`、`^block-id`）。
- Rust 端 SQLite FTS5 全库索引，编辑增量更新。
- 反链面板（含 unlinked mentions）。
- 全库 Graph View + Local Graph。

---

## 六、Zotero 学术集成需求（依据 ORACLE §9）

- CAYW HTTP 主路（v1，需用户本机 Zotero+BBT）。
- Zotero Web API 增量路（v1，离线可用，本地 SQLite 缓存）。
- 命令面板 `Cite from Zotero`（`Ctrl+Shift+Z`）+ Citation Panel + Insert Bibliography。
- 与 Typst `#cite()` / LaTeX `\cite{}` 自动联动。

---

## 七、视觉契约依赖

详见 [UI-SPEC.md](./UI-SPEC.md)。本 PRD 不重复视觉细节，但要求：

- 主题强调色 = 模式强调色，统一为单一 `--accent`。
- 右侧标签栏 active 态对比度 WCAG ≥ 4.5:1，禁止大面积色块背景。
- CSS 变量沿 Obsidian 命名习惯（`--background-primary` 等），值取 Atom one-dark/one-light HSL 6-hue 配色。

---

## 八、技术约束

| 约束 | 内容 |
|------|------|
| 桌面壳 | Tauri 2 (Rust + Web)，体积优先 |
| 前端 | React 19 + TypeScript strict |
| 状态 | Zustand 5 |
| 样式 | Tailwind 4（仅用于布局）+ 原生 CSS 变量（用于主题） |
| 编辑器内核 | CodeMirror 6 + `@lezer/markdown` |
| 数学 | KaTeX |
| Typst | `@myriaddreamin/typst.ts` (wasm) |
| Git | `git2` (libgit2 Rust binding) |
| GitHub | `@octokit/rest` + `@octokit/auth-oauth-device` |
| 全文索引 | SQLite FTS5 via `tauri-plugin-sql` |
| 文件系统 | `tauri-plugin-fs` |
| 进程 | `tauri-plugin-shell`（仅 sidecar） |

---

## 九、范围外（v1 不做）

- 实时多人协作（Yjs/CRDT 留 v3）
- 移动端（v2 评估）
- 插件市场（v2 评估）
- 内置 AI 写作（仅留 LSP 钩子）
- 成为代码 IDE（混合文档 OK，纯代码项目去用 VSCode/Cursor）
- 替代 Obsidian（兼容主题与 wiki-link 语法，不复刻插件 API）

---

## 十、版本路线

见 [ROADMAP.md](./ROADMAP.md)（ORACLE §13 的细化）。当前周期目标：v0.2 视觉与内核重铸。

---

## 十一、开发标准

### 11.1 代码规范

- TypeScript strict mode 强制
- ESLint + Prettier
- 组件文件 PascalCase（如 `EditorArea.tsx`），Hook 文件 `useXxx.ts`
- 单文件不超过 200 行（编辑器扩展除外）
- 类型集中在 `inkstream/src/types/`

### 11.2 测试策略

- ATDD：用户视角验收，规范文件位于 `specs/`（v0.2 全部重写中，详见 [specs/README.md](./specs/README.md)）
- 单元测试：Vitest，每个 CodeMirror 扩展配对测试
- E2E：Tauri 启动后跑 Playwright（v0.4 后引入）

### 11.3 Git 规范

- Conventional Commits（`feat:` / `fix:` / `chore:` / `refactor:`）
- 必须 SSH 签名（Verified 硬门）
- 所有 phase 用 GSD 工作流驱动（discuss → plan → execute → verify）
