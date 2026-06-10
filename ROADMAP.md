# InkStream 开发路线图

v1 目标：交付完整三模式桌面写作应用。共 12 个阶段，每阶段交付一个端到端可演示增量，阶段完成即推送本仓库并更新本文件。

## 总览

| # | 阶段 | 交付物 | 状态 |
|---|------|--------|------|
| 1 | 应用骨架与三模式 Workbench | Tauri 壳、五插槽布局、三模式预设与主题、命令面板 | 未开始 |
| 2 | CM6 单内核与工作区文件 | 唯一编辑器实例、11 种语言高亮、文件树、快速打开 | 未开始 |
| 3 | Live Preview 装饰层 | Source/Live Preview 切换、光标行还原、中文 IME 保障 | 未开始 |
| 4 | FTS5 索引与关系网络 | 全库索引（中文分词）、wiki-link 全语法、补全跳转、反链面板 | 未开始 |
| 5 | Fenced Block 三原语 | math (KaTeX) / typst (wasm SVG) / latex (MathJax)，懒加载 | 未开始 |
| 6 | Git 原生与 git-graph | libgit2 完整命令集、三栏 git-graph、跨平台凭据 | 未开始 |
| 7 | prose-aware diff | 中英混合句级 diff、git-graph Prose Diff 视图 | 未开始 |
| 8 | Zotero 集成与 Academic 模式 | CAYW picker、离线文献缓存、Citation Panel、参考文献、学术布局 | 未开始 |
| 9 | Creative 模式 | 章节导航树、Codex、Focus Mode、字数目标、场景概要 | 未开始 |
| 10 | Graph View 与 Standard 模式完成 | 全库/Local 图谱、Standard 完整三 tab 与状态栏 | 未开始 |
| 11 | GitHub 集成 | Device Flow 登录、Issue/PR、PR diff 内嵌审阅 | 未开始 |
| 12 | prose 三向合并与总装发布 | 三向冲突解决器、三模式总装验收、跨平台打包 | 未开始 |

## 阶段说明

### Phase 1 应用骨架与三模式 Workbench
启动桌面应用即见 TitleBar / Sidebar / EditorArea / RightPanel / StatusBar 五插槽工作台；通过命令面板在 Standard / Academic / Creative 三模式间切换，布局与强调色（石墨灰 / 学院深蓝 / 朱砂红）即时变化且不丢内容；主题以 Obsidian 命名习惯的 CSS 变量实现。

### Phase 2 CM6 单内核与工作区文件
打开文件夹作为工作区，文件树支持新建 / 重命名 / 删除 / 拖拽；全 App 单一 CodeMirror 6 实例承载编辑，Markdown、LaTeX、Typst、JS/TS、Python、Rust、JSON、YAML、HTML、CSS、Shell 语法高亮；外部修改提示重载；中文模糊快速打开。

### Phase 3 Live Preview 装饰层
Source 与 Live Preview 运行时切换；标题、加粗、列表、链接渲染为最终样式，光标所在行自动展开源码；中文输入法组合输入全程不被渲染打断；十万字文档输入延迟低于一帧。

### Phase 4 FTS5 索引与关系网络
`[[wiki-link]]` 支持 `|alias`、`#heading`、`^block-id` 全语法；输入 `[[` 弹出文件模糊补全；Ctrl+点击跳转、缺失目标提示创建；SQLite FTS5 全库索引（中文分词）随编辑增量更新；反链面板含 unlinked mentions。

### Phase 5 Fenced Block 三原语
math 块 KaTeX 实时渲染并支持 `/math` 触发器；typst 块经 typst.ts (wasm) 编译实时显示 SVG；latex 块由 MathJax 渲染；三引擎懒加载、互不干扰、三平台打包验证。

### Phase 6 Git 原生与 git-graph
status / log / diff / commit / checkout / merge / rebase / cherry-pick / stash / tag / reset / clone / push / pull / fetch 全命令集应用内可用；Ctrl+Shift+G 打开三栏 git-graph，右键菜单驱动全部操作，含 Find Widget 与分支过滤；点击 commit 联动编辑器 diff。

### Phase 7 prose-aware diff
中英混合句级分词、句级 LCS、段落对齐构成的语义 diff 流水线；git-graph 对比分支 / 提交时可切换 Prose Diff 视图；整本书量级文档分片处理不卡顿。

### Phase 8 Zotero 集成与 Academic 模式
Ctrl+Shift+Z 调起 Zotero CAYW picker 插入 `[@citekey]`；Web API 增量同步本地缓存，离线可读；Citation Panel 未解析标红；Insert Bibliography 支持 GB/T 7714 / APA / Vancouver；Academic 布局（文献库 + Citation Panel / Typst 预览 / Outline）与学术工具栏。

### Phase 9 Creative 模式
章节导航树（章 - 场景两级，字数 + 定稿 / 已修 / 草稿色点）；Codex 角色 / 地点 / 设定条目在编辑器中自动高亮、悬停显卡片；F11 Focus Mode；今日字数目标与状态栏进度条；场景概要卡片。

### Phase 10 Graph View 与 Standard 模式完成
Ctrl+G 全库 Graph View（力导向布局，可拖拽缩放）；RightPanel Local Graph；Standard 模式完整形态：大纲 / 反链 / Local Graph 三 tab 与完整状态栏。

### Phase 11 GitHub 集成
Device Flow 主路登录（PAT 与 gh 备用），token 存系统 keyring；Issue / PR 浏览、评论、创建；PR diff 内嵌编辑器审阅与 review 评论回复。

### Phase 12 prose 三向合并与总装发布
合并冲突的 prose-aware 三向解决器（按句 / 段采纳并预览）；三模式总装验收（切换不丢数据、撤销历史保留）；Windows / macOS / Linux 打包与更新链路演练；v1 发布。

## v1 范围外

实时多人协作（v3）、移动端（v2 评估）、插件市场（v2 评估）、内置 AI 写作（仅留 LSP 钩子）、成为代码 IDE、复刻 Obsidian 插件 API。

---

*更新于 2026-06-10：路线图建立。*
