# 旧 PRD 功能覆盖与验收索引

更新于 2026-09-13，当前代码为 main / 2.1.0，保留 2.0.0 旧功能修复的逐项证据。旧审计中的“缺少 rebase/clone/Codex/项目会话”等实现缺口已经合并发布，不能继续当作当前待开发项。原始用户要求的编号与内容保留在下表；状态区分实现与专项验收，不声称 v1 总验收已完成。

| 编号 | 原承诺 | 当前状态与后续 |
| --- | --- | --- |
| US-S1 | 新建默认 `.md`，立即输入并 Live Preview | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| US-S2 | 输入 `[[` 出现 vault 模糊候选，选择插入文件名 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| US-S3 | Ctrl+点击 wiki-link 跳转，不存在则提示创建 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| US-S4 | 反链显示来源文件及引用段落 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| US-S5 | Ctrl+G 查看全库链接网络 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| US-A1 | Ctrl+Shift+Z 通过 BBT picker 插入 `[@citekey]` | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| US-A2 | Citation Panel 汇总当前引用，未解析标红 | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| US-A3 | `:::typst` 块实时 SVG，位于块右侧 | 两种 Typst 块、预览和状态已有实现；[真实渲染验收](https://github.com/KRPCT/InkStream/issues/26)保留。 |
| US-A4 | Insert Bibliography 插入 `<!-- biblio -->`，展开 GB/T 7714/APA/Vancouver | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| US-A5 | 设置 Web API key 后离线阅读文献缓存 | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| US-C1 | 打开项目自动显示章→场景树，带字数及三种状态 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| US-C2 | F11 Focus Mode 淡化非当前段落 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| US-C3 | 设置今日目标 2000，状态栏实时进度 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| US-C4 | 在 Codex 添加角色，提及时高亮并悬停角色卡 | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| US-C5 | Git Graph 比较两个 draft 分支并看句级差异 | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| US-F1 | `/math` 插入块并实时显示 KaTeX | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| US-F2 | typst fenced block 公式实时 SVG | 两种 Typst 块、预览和状态已有实现；[真实渲染验收](https://github.com/KRPCT/InkStream/issues/26)保留。 |
| US-F3 | LaTeX 公式 Live Preview，并导出 PDF 片段 | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| MODE-01 | Standard/Academic/Creative 随时切换；布局、工具及指标预设；不绑定格式、不丢数据 | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| STD-01 | 按 Git 根展示工作区文件树 | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| STD-02 | 右栏 Outline/Backlinks/Local Graph 三 tab | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| STD-03 | 状态栏显示路径、Git 分支、字数、光标、渲染模式 | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| ACA-01 | 左栏上方 Zotero 同步状态，下方文件树 | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| ACA-02 | 右栏 Citation/Typst Preview/Outline | 两种 Typst 块、预览和状态已有实现；[真实渲染验收](https://github.com/KRPCT/InkStream/issues/26)保留。 |
| ACA-03 | 学术工具栏：引用、脚注、参考文献、公式编号 | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| ACA-04 | 状态栏：引用数、未解析提示、Typst 编译状态 | 两种 Typst 块、预览和状态已有实现；[真实渲染验收](https://github.com/KRPCT/InkStream/issues/26)保留。 |
| CRE-01 | 左栏章→场景树含字数/状态 | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| CRE-02 | 右栏 Codex 角色/地点/设定及场景概要 | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| CRE-03 | 编辑器顶部可折叠场景概要卡及 Focus Mode | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| CRE-04 | 状态栏今日字数/目标、章节场景计数、定稿色点 | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| EDIT-01 | 纯文本为权威，渲染不偷换内容 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| EDIT-02 | Source/Live Preview 运行时切换，命令与状态栏一致 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| EDIT-03 | 标题、粗体、列表、链接、fenced、wiki-link、citation 最终样式 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| EDIT-04 | 光标所在行展开源代码 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LANG-01 | Markdown/Obsidian 变体 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LANG-02 | LaTeX | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LANG-03 | Typst | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LANG-04 | JavaScript / TypeScript | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LANG-05 | Python | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LANG-06 | Rust | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LANG-07 | JSON | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LANG-08 | YAML | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LANG-09 | HTML | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LANG-10 | CSS | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LANG-11 | Shell | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| FMT-01 | 新建默认 `.md` + UTF-8 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| FMT-02 | frontmatter `language: markdown/latex/typst/richtext` 整体切语言 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| FMT-03 | richtext 简化 Markdown，B/I/U/链接工具栏，物理仍 Markdown | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| `git_status` | `src-tauri/src/git/status.rs`、`src/ipc/git.ts`、`SidebarGitPanel.tsx` | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_branch_list` | `src-tauri/src/git/branch.rs`、`BranchManager.tsx` | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_log` | `src-tauri/src/git/log.rs`、`graph/CommitGraphList.tsx` | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_diff` | `src-tauri/src/git/diff.rs`、`FileDiffPanel.tsx` | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_commit` | `src-tauri/src/git/commit.rs` 的系统 `git commit -S`、`src/editor/gitActions.ts` | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_checkout` | `src-tauri/src/git/refops.rs`、`BranchManager.tsx`、`GitContextMenu.tsx` | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_merge` | `src-tauri/src/git/commit.rs`、`MergeResolver.tsx` | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_rebase` | `src-tauri/src/git/rebase.rs` 提供 `git_rebase` 与 `git_rebase_status`，支持本地变基与状态恢复 | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_cherry_pick` | `src-tauri/src/git/commit.rs`、`GitContextMenu.tsx` | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_stash` | `src-tauri/src/git/stash.rs` 提供 save/list/pop/drop，`gitActions.ts` 有 stash 动作 | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_tag` | `src-tauri/src/git/refops.rs` create/delete、`GitContextMenu.tsx` | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_reset` | `src-tauri/src/git/refops.rs` soft/mixed/hard、`GitContextMenu.tsx` | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_clone` | `src-tauri/src/git/clone.rs` 与 `GitCloneDialog.tsx` 提供可取消的克隆与完成后打开流程 | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_push` | `src-tauri/src/git/remote.rs`、`src/editor/gitActions.ts` | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_pull` | `src-tauri/src/git/remote.rs` fetch + ff-only merge | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| `git_fetch` | `src-tauri/src/git/remote.rs`、Git 工具条/侧栏 | 补全实现已随 2.0.0 合并，对应实现票已关闭；组合用户流程继续归[总验收](https://github.com/KRPCT/InkStream/issues/25)。 |
| GRAPH-GIT-01 | 图谱/提交详情/文件 diff 三栏 | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| GRAPH-GIT-02 | 右键菜单驱动所有操作 | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| GRAPH-GIT-03 | Find Widget | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| GRAPH-GIT-04 | Filter Branches | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| GRAPH-GIT-05 | Repository Settings | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| GRAPH-GIT-06 | 点击 commit 在编辑器右侧自动打开 diff | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| GRAPH-GIT-07 | 菜单 View→Git Graph 与 Ctrl+Shift+G | 已有发布功能；本轮对齐多栏呈现和交互，[工作台任务](https://github.com/KRPCT/InkStream/issues/47)记录新增证据。 |
| GH-01 | OAuth Device Flow 登录 | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| GH-02 | PAT 备用登录 | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| GH-03 | 已登录 gh CLI 备用登录 | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| GH-04 | Issue 浏览、评论、创建 | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| GH-05 | PR 浏览、评论、创建 | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| GH-06 | PR diff 内嵌编辑器 | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| GH-07 | PR review 评论回复 | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| DIFF-01 | 中英句级分词→LCS→段落对齐→语义高亮 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| DIFF-02 | prose-aware 三向冲突解决器 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LINK-01 | wiki-link 基础目标及 alias | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LINK-02 | `#heading` 链接定位 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LINK-03 | `^block-id` 链接定位 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LINK-04 | SQLite FTS5 全库索引 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LINK-05 | 编辑增量索引 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LINK-06 | 反链含未链接提及 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LINK-07 | 全库图谱 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| LINK-08 | 当前文档 Local Graph | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| ZOT-01 | 本地 CAYW HTTP 主路，需 Zotero+BBT | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| ZOT-02 | Web API 增量、离线 SQLite 缓存 | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| ZOT-03 | 命令面板 Cite from Zotero + 引用面板 + Insert Bibliography | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| ZOT-04 | Typst `#cite()` / LaTeX `\cite{}` 自动联动 | 已有发布实现；真实账户/文献矩阵见 [文献](https://github.com/KRPCT/InkStream/issues/29)、[登录](https://github.com/KRPCT/InkStream/issues/36)、[评论](https://github.com/KRPCT/InkStream/issues/37)。 |
| USER-01 | §1：研究者可在一 App 完成引用、公式、Git 多稿及 Prose Diff | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| USER-02 | §1：创作者章节、Codex、专注及多稿合并 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| USER-03 | §1/§9：Obsidian 主题导入即用、兼容主题 | 主题变量导入已发布；[真实主题矩阵](https://github.com/KRPCT/InkStream/issues/38)保留，非任意 CSS 兼容声明。 |
| USER-04 | §1：混合 Markdown 与多语言代码写作 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| REL-01 | §2/§3：切模式/操作不丢纯文本 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| REL-02 | §4/§5：工作区身份与索引正确 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| REL-03 | §4：Git 认证和远程动作可信 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| REL-04 | 桌面编辑的文件属性与大文件响应 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| REL-05 | 旧开发标准所需可执行验证基线 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |
| REL-06 | 后续已加入的功能不得因补旧 PRD 回归 | 已有发布实现或保持的行为约束；完整平台/组合场景仍由[总验收](https://github.com/KRPCT/InkStream/issues/25)逐项收口。 |

## 技术约束的当前解释

- 保留主 CodeMirror、纯文本权威与文档身份/保存/恢复边界；辅助视图不是独立正文权威。
- 配色按当前用户确认的纸白、石墨灰、灰绿；旧固定模式色不阻止 UX 收敛，语法/错误等有功能的颜色仍保留。
- 保留当前 Tauri/React/Zustand、类型约束与 CSS token；版本从实际配置读取。
- Git 由 git2 与受管系统 git 共同承担；GitHub REST/Device Flow 使用现有原生实现，不要求旧指定 SDK。
- GSD 与已缺失旧 ORACLE/UI-SPEC 的历史引用不再是当前强制入口。当前遵循 wayfinder、DDD/BDD 与明确用户要求。

## 旧范围边界

原路线图的云协作、插件市场、多项目后台并行等未来设想不因发布号为 2.0.0 而自动实现或纳入本轮。已出现的阅读/书架/终端/导出/主题/更新能力按现有产品文档维护。完整原始审计保存在本地 governance-originals，旧失败与旧未验证记录不被改写为通过。
