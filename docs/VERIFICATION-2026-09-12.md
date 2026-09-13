# 历史记录：VERIFICATION-2026-09-12.md

此文件保留原日期、原工作树与当时证据。最新实现/合并/发布状态见 [CURRENT-STATE](CURRENT-STATE.md)；下面“尚未实施/未推送/草稿 PR”等文字是历史状态，不作为当前指令。

<details>
<summary>查看原始历史记录</summary>

# 2026-09-12 续接验证与旧 v1 验收索引

本报告记录当前 `codex/con-repair-v1` 的未提交工作区。原分支未改变；没有推送或触发 GitHub Actions。

**旧 v1 总验收 #25 仍开放；正式 UIUX、新项目档案与持久草稿尚未开始。** 测试文件关联只用于定位证据，不表示一整行用户需求已经验收。

## 已核验结果

| 检查 | 结果 | 本机证据 |
|---|---|---|
| typecheck | 通过 | [报告](../coverage/acceptance/ci-typecheck-win32-1789192346084-58100/ci-summary.json) |
| lint | 通过 | [报告](../coverage/acceptance/ci-lint-win32-1789192465348-46236/ci-summary.json) |
| test | 1707/1707，无失败、跳过或超时 | [报告](../coverage/acceptance/ci-test-win32-1789192674321-41828/ci-summary.json) |
| build | 通过 | [报告](../coverage/acceptance/ci-build-win32-1789192471654-55828/ci-summary.json) |
| Windows Rust | 208 通过；1 个进程 helper 由其他测试调用；复用最近一次原生报告 | [报告](../coverage/acceptance/rust-win32-1789187386473-59604/rust-summary.json) |
| Windows 原生学术流程 | 22 个检查点通过；使用合成 BBT 与模拟 composition 事件 | [记录](../coverage/acceptance/native-academic-20260912-135519/academic-checks.json) |
| Windows 原生分支比较 | 15 个已通过检查点；复用此前实际 WebView 证据 | [记录](../coverage/acceptance/native-compare-20260912-114656/browser-checks.json) |

新增修复：实时预览只隐藏 Markdown 转义前缀，保留 `[1]`、`[J]` 等字面标点；活动行、源码模式、代码块、IME 与撤销保持原文。先复现 4 项失败，再通过 100 项相关回归，最后重建并以原生截图核验。

[修复后原生截图](../coverage/acceptance/native-academic-20260912-135519/academic-bibliography.png)。最终源文件校验值与进程/端口结果见[工作区汇总](../coverage/acceptance/continuation-20260912/summary.json)和[源码哈希](../coverage/acceptance/continuation-20260912/source-sha256.json)。

生产 `dist` 已检查，不含测试桥接入口。两次本轮原生测试的 HEAD、index、工作树快照一致；其子进程已回收，1420/9229/23119 端口关闭。

## 仍未满足的进入条件

Linux：本机 WSL 列出 Ubuntu 24.04，但实例启动返回 `Wsl/Service/CreateInstance/CreateVm/HCS/HCS_E_SERVICE_NOT_AVAILABLE`。仅作只读诊断，没有启用系统功能或修改虚拟化服务。macOS：Darwin 进程回收修复仍无该平台执行证据。

外部服务：构建环境未提供 `INKSTREAM_GITHUB_CLIENT_ID`。真实 GitHub OAuth、系统钥匙串、Zotero/BBT 与 Web API、授权远程 clone/Git/PR 回复仍未验收；本地合成服务不能替代。此前已提出配置依赖，本轮没有重复索取凭据，也没有发送远程评论。

本地完整场景：基础写作、索引/真实 watcher、长篇创作、全部 Git 入口、主题导入与既有能力的贯通流程仍需逐行核对或归档。`scripts/acceptance/bindings.mjs` 中原有 partial/pending 没有被批量改成完成。

## 证据组与剩余场景

| 组 | 范围 | 相关检查（不等于完整覆盖） | 尚缺证据 |
|---|---|---|---|
| DOC | 文档保存与生命周期 | [document-session.integration.test.tsx](../src/test/document-session.integration.test.tsx)、[documentFileMutations.test.ts](../src/editor/documentFileMutations.test.ts)、[exitGuard.test.ts](../src/editor/exitGuard.test.ts) | DOC-01–08 的完整场景与磁盘往返证据仍须逐条归档。 |
| WIKI | 链接补全与定位 | [wikiLinkComplete.test.ts](../src/editor/livepreview/wikiLinkComplete.test.ts)、[wikiNavigation.test.ts](../src/editor/livepreview/wikiNavigation.test.ts)、[wikiAnchor.test.ts](../src/editor/livepreview/wikiAnchor.test.ts) | 组合输入、补全产物到真实点击、原生可见落点仍须贯通核对。 |
| INDEX | 索引与关系查询 | [indexLifecycle.test.ts](../src/ipc/indexLifecycle.test.ts)、[indexRefresh.test.ts](../src/ipc/indexRefresh.test.ts)、[BacklinksPanel.paragraph.test.tsx](../src/components/workbench/BacklinksPanel.paragraph.test.tsx)、[render.test.ts](../src/graph/render.test.ts) | WS-01–08 的真实 watcher、跨库索引及面板联动仍须归档。 |
| CITE | 引用与学术命令 | [academicActions.integration.test.ts](../src/editor/academicActions.integration.test.ts)、[academicActions.test.ts](../src/editor/academicActions.test.ts)、[citations.test.ts](../src/editor/citations.test.ts) | 22 个原生检查使用本地合成 BBT；真实 Zotero/BBT picker 与引用面板全场景待验收。 |
| BIB | 参考文献与转义显示 | [bibliography.integration.test.ts](../src/editor/bibliography.integration.test.ts)、[cslFormat.standard.test.ts](../src/editor/cslFormat.standard.test.ts)、[escapePreview.test.ts](../src/editor/livepreview/escapePreview.test.ts) | 真实文献库、多文献类型与三种样式的端到端符合性仍须核验。 |
| ZOT | 文献库账户与离线同步 | [ZoteroLibraryPanel.account.test.tsx](../src/components/workbench/ZoteroLibraryPanel.account.test.tsx)、[ZoteroLibraryPanel.test.tsx](../src/components/workbench/ZoteroLibraryPanel.test.tsx) | 真实 Web API 同步、断网重启、系统凭据库待验收；合成 HTTP/SQLite 不替代真实账户。 |
| TYP | Typst 预览与首次加载 | [TypstFlow.test.tsx](../src/components/workbench/TypstFlow.test.tsx)、[languages.typst.test.ts](../src/editor/languages.typst.test.ts)、[typstClient.lifecycle.test.ts](../src/editor/livepreview/typst/typstClient.lifecycle.test.ts) | 首次 .typ 原生语法树已有证据；完整双语法、多修订、故障恢复场景仍须逐条归档。 |
| EQ | 公式、编号与导出 | [equationNumbering.flow.test.tsx](../src/editor/equationNumbering.flow.test.tsx)、[equationPdf.flow.test.tsx](../src/editor/export/equationPdf.flow.test.tsx)、[slashCommand.test.ts](../src/editor/livepreview/slashCommand.test.ts) | 公式导出核心已有历史实机证据；原生保存对话框、重开与各编号场景仍须归档。 |
| CRE | 长篇创作 | [chapterTree.test.ts](../src/editor/chapterTree.test.ts)、[writingMetrics.test.ts](../src/editor/writingMetrics.test.ts)、[CodexPanel.lifecycle.test.tsx](../src/components/workbench/CodexPanel.lifecycle.test.tsx)、[focusMode.test.ts](../src/editor/livepreview/focusMode.test.ts) | 章节→Codex→目标→比较/合并→保存重开及物理中文 IME 的贯通验收未完成。 |
| CMP | 完整分支比较 | [BranchCompareView.test.tsx](../src/components/git/BranchCompareView.test.tsx)、[branchComparisonClient.test.ts](../src/editor/branchComparisonClient.test.ts)、[comparisonView.test.ts](../src/editor/comparisonView.test.ts)、[compareText.test.ts](../src/diff/compareText.test.ts) | Windows 双分支、长文、增删改名、分页与未保存缓冲场景已有原生证据；跨平台仍未验证。 |
| SHELL | 模式与工作区入口 | [totalAssembly.test.ts](../src/modes/totalAssembly.test.ts)、[WorkbenchLayout.test.tsx](../src/components/workbench/WorkbenchLayout.test.tsx)、[StatusBar.document.test.tsx](../src/components/workbench/StatusBar.document.test.tsx)、[FileTree.test.tsx](../src/components/workbench/FileTree.test.tsx) | 三模式长会话、能力关闭后继续编辑及全部入口仍须贯通核对。 |
| MD | Markdown 与实时预览 | [inlinePlugin.test.ts](../src/editor/livepreview/inlinePlugin.test.ts)、[escapePreview.test.ts](../src/editor/livepreview/escapePreview.test.ts)、[editorState.renderMode.test.ts](../src/editor/editorState.renderMode.test.ts)、[Toolbar.test.tsx](../src/editor/richtext/Toolbar.test.tsx) | 转义显示已有原生复验；其余语法与模式往返需按旧矩阵逐项归档。 |
| LANG | 多语言与文件格式 | [languages.test.ts](../src/editor/languages.test.ts)、[codeLanguages.test.ts](../src/editor/livepreview/codeLanguages.test.ts)、[frontmatter.test.ts](../src/editor/frontmatter.test.ts) | 各语言真实文件的首次打开、混合写作、保存重开与错误路径仍待逐项验收。 |
| GIT | 本地 Git 生命周期 | [gitActions.test.ts](../src/editor/gitActions.test.ts)、[gitWorktreeMutation.test.ts](../src/editor/gitWorktreeMutation.test.ts) | status/log/branch/diff 有真实 Rust 证据；全部菜单、右键、merge/cherry-pick/tag/reset 的完整生命周期仍需核验。 |
| REB | 本地 rebase | [BranchManager.rebase.test.tsx](../src/components/git/BranchManager.rebase.test.tsx)、[RebaseControls.test.tsx](../src/components/git/RebaseControls.test.tsx)、[gitWorktreeMutation.test.ts](../src/editor/gitWorktreeMutation.test.ts) | Windows Rust 成功/冲突/签名失败恢复通过；Linux/macOS 进程回收与原生入口全流程待验收。 |
| STA | Stash 管理 | [gitStashActions.test.ts](../src/editor/gitStashActions.test.ts)、[StashEntry.test.tsx](../src/components/git/StashEntry.test.tsx) | Rust 临时仓库恢复/冲突/身份通过；真实应用完整保存/恢复/删除手势链待归档。 |
| CLONE | 克隆与打开工作区 | [GitCloneDialog.test.tsx](../src/components/git/GitCloneDialog.test.tsx)、[CloneEntry.test.tsx](../src/components/workbench/CloneEntry.test.tsx) | 本地 Git 克隆与排他发布通过；授权远程、原生进度/取消/成功打开仍需验收。 |
| REMOTE | 远程 Git 与凭据目标 | [git.remote.test.ts](../src/ipc/git.remote.test.ts)、[gitCredential.test.ts](../src/ipc/gitCredential.test.ts)、[gitActions.test.ts](../src/editor/gitActions.test.ts) | 真实授权远程 Git、PAT/gh 与系统凭据链待验收；不代替用户注册或授权。 |
| GITUI | Git 图谱交互 | [layoutGraph.test.ts](../src/components/git/graph/layoutGraph.test.ts)、[builtins.test.ts](../src/commands/builtins.test.ts)、[menuConfig.test.ts](../src/components/workbench/menuConfig.test.ts) | Find、Filter Branches、仓库设置及各入口组合仍需逐项实际操作验收。 |
| AUTH | GitHub Device Flow | [GithubDeviceFlow.test.tsx](../src/components/settings/GithubDeviceFlow.test.tsx) | 需要 InkStream 自有公开 Client ID、真实授权与钥匙串读回；当前环境未配置该变量。 |
| PR | Issue / PR / review | [PrReply.test.tsx](../src/components/git/PrReply.test.tsx)、[CommentThread.scope.test.tsx](../src/components/git/CommentThread.scope.test.tsx) | 授权仓库真实读取、回复后读回、分页权限待验收；远程发送还需明确授权。 |
| MERGE | 三向冲突 | [parseConflicts.test.ts](../src/diff/parseConflicts.test.ts)、[MergeResolver.scope.test.tsx](../src/components/git/MergeResolver.scope.test.tsx) | base/ours/theirs 与全部非冲突上下文的原生合并/取消/保存重开链待验收。 |
| THEME | 主题导入兼容 | [themeImport.test.ts](../src/styles/themeImport.test.ts)、[ImportedTheme.test.tsx](../src/components/settings/ImportedTheme.test.tsx) | 代表性第三方主题、重启保持、取消及失败回退的原生证据仍需逐项归档。 |
| QUALITY | 传输、权限与检查基线 | [documentBudget.integration.test.tsx](../src/editor/documentBudget.integration.test.tsx)、[files.streaming.test.ts](../src/ipc/files.streaming.test.ts)、[files.writing.test.ts](../src/ipc/files.writing.test.ts) | Windows 检查与 Raw 传输已有证据；Unix 文件属性和 macOS 清理未验证，旧 CI 不替代验收。 |
| EXISTING | 后续既有能力 | [HtmlReader.transfer.test.tsx](../src/components/reading/HtmlReader.transfer.test.tsx)、[TerminalPanel.test.tsx](../src/components/terminal/TerminalPanel.test.tsx)、[replaceAll.test.ts](../src/editor/multibuffer/replaceAll.test.ts)、[useUpdaterStore.test.ts](../src/stores/useUpdaterStore.test.ts) | 简易模式、阅读/书架、终端、更新、multibuffer、缩放的完整组合仍需回归归档。 |
| E2E | 跨领域用户流程 | 须复用各子流程并实际贯通 | 前置子流程与真实外部依赖仍开放；不能由测试总数替代完整用户故事。 |

## 原矩阵逐行索引

共 102 行，覆盖原矩阵第 1–7 节全部功能编号；第 8 节技术条款与第 9 节非目标维持原裁定。每行完整接受仍为 false，不能由本表关联自动关闭 #25。详细机器记录见 [legacy-v1-rows.json](../coverage/acceptance/continuation-20260912/legacy-v1-rows.json)。

| 原编号 | 证据组 | 完整场景验收 |
|---|---|---|
| US-S1 | DOC | 待完整核验；缺口见对应组 |
| US-S2 | WIKI | 待完整核验；缺口见对应组 |
| US-S3 | WIKI | 待完整核验；缺口见对应组 |
| US-S4 | INDEX | 待完整核验；缺口见对应组 |
| US-S5 | INDEX | 待完整核验；缺口见对应组 |
| US-A1 | CITE | 待完整核验；缺口见对应组 |
| US-A2 | CITE | 待完整核验；缺口见对应组 |
| US-A3 | TYP | 待完整核验；缺口见对应组 |
| US-A4 | BIB | 待完整核验；缺口见对应组 |
| US-A5 | ZOT | 待完整核验；缺口见对应组 |
| US-C1 | CRE | 待完整核验；缺口见对应组 |
| US-C2 | CRE | 待完整核验；缺口见对应组 |
| US-C3 | CRE | 待完整核验；缺口见对应组 |
| US-C4 | CRE | 待完整核验；缺口见对应组 |
| US-C5 | CMP | 待完整核验；缺口见对应组 |
| US-F1 | EQ | 待完整核验；缺口见对应组 |
| US-F2 | TYP | 待完整核验；缺口见对应组 |
| US-F3 | EQ | 待完整核验；缺口见对应组 |
| MODE-01 | SHELL | 待完整核验；缺口见对应组 |
| STD-01 | SHELL | 待完整核验；缺口见对应组 |
| STD-02 | SHELL | 待完整核验；缺口见对应组 |
| STD-03 | SHELL | 待完整核验；缺口见对应组 |
| ACA-01 | ZOT | 待完整核验；缺口见对应组 |
| ACA-02 | TYP | 待完整核验；缺口见对应组 |
| ACA-03 | EQ | 待完整核验；缺口见对应组 |
| ACA-04 | TYP | 待完整核验；缺口见对应组 |
| CRE-01 | CRE | 待完整核验；缺口见对应组 |
| CRE-02 | CRE | 待完整核验；缺口见对应组 |
| CRE-03 | CRE | 待完整核验；缺口见对应组 |
| CRE-04 | CRE | 待完整核验；缺口见对应组 |
| EDIT-01 | DOC | 待完整核验；缺口见对应组 |
| EDIT-02 | MD | 待完整核验；缺口见对应组 |
| EDIT-03 | MD | 待完整核验；缺口见对应组 |
| EDIT-04 | MD | 待完整核验；缺口见对应组 |
| LANG-01 | MD | 待完整核验；缺口见对应组 |
| LANG-02 | LANG | 待完整核验；缺口见对应组 |
| LANG-03 | TYP | 待完整核验；缺口见对应组 |
| LANG-04 | LANG | 待完整核验；缺口见对应组 |
| LANG-05 | LANG | 待完整核验；缺口见对应组 |
| LANG-06 | LANG | 待完整核验；缺口见对应组 |
| LANG-07 | LANG | 待完整核验；缺口见对应组 |
| LANG-08 | LANG | 待完整核验；缺口见对应组 |
| LANG-09 | LANG | 待完整核验；缺口见对应组 |
| LANG-10 | LANG | 待完整核验；缺口见对应组 |
| LANG-11 | LANG | 待完整核验；缺口见对应组 |
| FMT-01 | DOC | 待完整核验；缺口见对应组 |
| FMT-02 | LANG | 待完整核验；缺口见对应组 |
| FMT-03 | MD | 待完整核验；缺口见对应组 |
| git_status | GIT | 待完整核验；缺口见对应组 |
| git_branch_list | GIT | 待完整核验；缺口见对应组 |
| git_log | GIT | 待完整核验；缺口见对应组 |
| git_diff | GIT | 待完整核验；缺口见对应组 |
| git_commit | GIT | 待完整核验；缺口见对应组 |
| git_checkout | GIT | 待完整核验；缺口见对应组 |
| git_merge | GIT | 待完整核验；缺口见对应组 |
| git_rebase | REB | 待完整核验；缺口见对应组 |
| git_cherry_pick | GIT | 待完整核验；缺口见对应组 |
| git_stash | STA | 待完整核验；缺口见对应组 |
| git_tag | GIT | 待完整核验；缺口见对应组 |
| git_reset | GIT | 待完整核验；缺口见对应组 |
| git_clone | CLONE | 待完整核验；缺口见对应组 |
| git_push | REMOTE | 待完整核验；缺口见对应组 |
| git_pull | REMOTE | 待完整核验；缺口见对应组 |
| git_fetch | REMOTE | 待完整核验；缺口见对应组 |
| GRAPH-GIT-01 | GITUI | 待完整核验；缺口见对应组 |
| GRAPH-GIT-02 | GIT | 待完整核验；缺口见对应组 |
| GRAPH-GIT-03 | GITUI | 待完整核验；缺口见对应组 |
| GRAPH-GIT-04 | GITUI | 待完整核验；缺口见对应组 |
| GRAPH-GIT-05 | REMOTE | 待完整核验；缺口见对应组 |
| GRAPH-GIT-06 | CMP | 待完整核验；缺口见对应组 |
| GRAPH-GIT-07 | GITUI | 待完整核验；缺口见对应组 |
| GH-01 | AUTH | 待完整核验；缺口见对应组 |
| GH-02 | REMOTE | 待完整核验；缺口见对应组 |
| GH-03 | REMOTE | 待完整核验；缺口见对应组 |
| GH-04 | PR | 待完整核验；缺口见对应组 |
| GH-05 | PR | 待完整核验；缺口见对应组 |
| GH-06 | PR | 待完整核验；缺口见对应组 |
| GH-07 | PR | 待完整核验；缺口见对应组 |
| DIFF-01 | CMP | 待完整核验；缺口见对应组 |
| DIFF-02 | MERGE | 待完整核验；缺口见对应组 |
| LINK-01 | WIKI | 待完整核验；缺口见对应组 |
| LINK-02 | WIKI | 待完整核验；缺口见对应组 |
| LINK-03 | WIKI | 待完整核验；缺口见对应组 |
| LINK-04 | INDEX | 待完整核验；缺口见对应组 |
| LINK-05 | INDEX | 待完整核验；缺口见对应组 |
| LINK-06 | INDEX | 待完整核验；缺口见对应组 |
| LINK-07 | INDEX | 待完整核验；缺口见对应组 |
| LINK-08 | INDEX | 待完整核验；缺口见对应组 |
| ZOT-01 | CITE | 待完整核验；缺口见对应组 |
| ZOT-02 | ZOT | 待完整核验；缺口见对应组 |
| ZOT-03 | CITE | 待完整核验；缺口见对应组 |
| ZOT-04 | CITE | 待完整核验；缺口见对应组 |
| USER-01 | E2E | 待完整核验；缺口见对应组 |
| USER-02 | E2E | 待完整核验；缺口见对应组 |
| USER-03 | THEME | 待完整核验；缺口见对应组 |
| USER-04 | LANG | 待完整核验；缺口见对应组 |
| REL-01 | DOC | 待完整核验；缺口见对应组 |
| REL-02 | INDEX | 待完整核验；缺口见对应组 |
| REL-03 | REMOTE | 待完整核验；缺口见对应组 |
| REL-04 | QUALITY | 待完整核验；缺口见对应组 |
| REL-05 | QUALITY | 待完整核验；缺口见对应组 |
| REL-06 | EXISTING | 待完整核验；缺口见对应组 |

</details>
