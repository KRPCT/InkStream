# GitHub 集成

在 InkStream 内登录 GitHub，浏览和管理 Pull Request、Issue，撰写评论，做 PR 审阅，不用切到浏览器或终端。

## 登录 GitHub

GitHub 登录入口在「设置 ▸ 账户」分区。

打开方式：

1. 按 `Ctrl+,` 打开设置，或从命令面板（`Ctrl+Shift+P`）执行「视图：设置」。
2. 在左侧分类中点「账户」。

登录有三种方式：

- 浏览器登录：点「通过浏览器登录 GitHub」，在固定的 GitHub 验证页面输入应用显示的验证码，并确认授权。等待期间可以取消或重新获取验证码；关闭账户设置会取消该页面的设备登录。
- 个人访问令牌（PAT）：填写令牌后点「使用 PAT 登录」。访问私有仓库时需授予对应仓库权限；经典 PAT 通常需要 `repo` 权限。
- 本机 gh CLI：若本机 `gh` 已在 github.com 登录，可点「使用本机 gh CLI 登录」。InkStream 只读取现有令牌，不修改 gh 的登录账户。

浏览器登录需要 GitHub OAuth App 的公开 Client ID，并在该 App 设置中启用 Device Flow。发布版本可在构建时通过 `INKSTREAM_GITHUB_CLIENT_ID` 配置；若当前版本没有配置，浏览器登录按钮会暂时禁用，也可填写自己注册的 OAuth App Client ID。客户端不需要也不接受 Client Secret。具体流程见 [GitHub Device Flow 官方说明](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)。

登录成功后，账户分区显示「已登录」并提供「登出 GitHub」按钮。浏览器登录会显示刚验证的 GitHub 用户名。设备码、访问令牌和刷新令牌均由原生端处理；界面只接收验证码、状态和用户名。凭据与过期信息保存在本机系统凭据库的同一条目中，旧版本保存的 PAT/gh 令牌可以继续使用。

对于 GitHub 返回的有过期时间的 OAuth 令牌，GitHub API 与 HTTPS Git 操作会在使用前按需刷新。授权被撤销或刷新令牌已过期时，应用会要求重新登录；网络失败时不会把已过期令牌交给 Git。切换 PAT、gh 或登出会取消旧的设备授权和刷新请求，迟到结果不能覆盖新的账户选择。

GitHub 账户仅用于通过准入检查的 github.com HTTPS 地址；本地、SSH、自定义地址等方式按「Git ▸ 远程方式」处理。SSH 需要仓库的 SSH remote URL 与本机密钥。点「登出 GitHub」会删除 InkStream 保存的本机凭据；如需在 GitHub 服务端撤销 OAuth App 授权，可在 GitHub 的 Applications 设置中操作。

## 打开 Git Graph 与切换标签

GitHub 的 PR / Issues 视图位于 Git Graph 页面内。

- 按 `Ctrl+Shift+G` 打开 Git Graph，或从命令面板执行「Git Graph」。
- 仅在当前工作区是 git 仓库时可用；否则会提示「当前工作区不是 git 仓库」。

Git Graph 顶部可切换图谱、分支、分支比较、暂存记录、PR 与 Issues。点「PR」或「Issues」即可进入对应视图。

提示：`Ctrl+G` 打开的是知识图谱（双向链接网络），与 Git Graph 不是同一个功能，请勿混用。

## Pull Request

在 Git Graph 顶部切到「PR」标签：

- 列表展示当前仓库的开放 PR，每条显示编号、标题、来源分支 → 目标分支、作者，草稿 PR 标注「草稿」。
- 点标题进入 PR 详情（中栏），同时右栏会载入该 PR 的逐文件 diff 供审阅。
- 点条目右侧的外链图标可在浏览器打开该 PR。
- 点顶部「刷新」重新拉取列表。
- 列表按页加载，使用分页控件查看后续 PR；一页结果不是全部仓库记录。

新建 PR：

1. 点 PR 面板顶部的「新建」。
2. 来源分支默认是当前所在分支；在「目标分支」输入框填写要合并进的分支（默认填入 main、其次 master）。
3. 填写 PR 标题，点「创建」。

合并 PR：把鼠标移到某条 PR 上，会出现「合并」「压缩」「变基」三个按钮，分别对应 merge、squash、rebase 三种合并方式。若 GitHub 因冲突等原因未能合并，会给出提示。

## PR 内嵌 diff 审阅与 Review

点开某个 PR 进入详情后：

- 中栏显示 PR 标题、正文、作者、来源 → 目标分支，以及已有的 Review 列表（含审阅者与状态）。
- 右栏内嵌该 PR 的逐文件代码 diff，可以直接在 InkStream 里审阅改动。

提交你自己的 Review：

1. 在中栏的「Review 评语」文本框写下意见。
2. 点对应按钮：
   - 批准：表示同意合并（评语可留空）。
   - 请求修改：要求作者修改（必须填写评语）。
   - 评论：仅留言、不表态（必须填写评语）。

PR 详情中的“代码审阅讨论”按文件位置列出原评论和回复，可展开上下文，再回复对应讨论。旧版本位置会单独标注；读取或发送失败时显示原因，保留尚未发送的文字。切换 PR 后，旧请求不会覆盖新 PR 的讨论或输入。该回复入口使用 PR review comment 线程，与下方普通评论区分开。

## Issue

在 Git Graph 顶部切到「Issues」标签：

- 顶部有「开放 / 已关闭 / 全部」三个筛选按钮，切换查看不同状态的 Issue。
- 列表每条显示标题、编号、作者与评论数。
- 点「刷新」重新拉取列表。
- 列表按页加载，筛选或切换仓库时重新读取对应结果。

新建 Issue：

1. 点 Issues 面板顶部的「新建 Issue」按钮（加号图标）。
2. 填写 Issue 标题，点「创建」。

查看 Issue 详情：点列表中任意 Issue 进入详情页，可看到标题、正文、作者与状态，以及下方的评论线程；点右上角外链图标可在浏览器打开。点「返回列表」回到列表。

## 评论

Issue 详情页与 PR 详情页底部都有共用的评论线程：

- 上方按顺序列出已有评论，每条显示作者与内容。
- 在底部文本框写下内容，点「评论」即可发表。

以上是 2.0 已实现的入口与处理流程。真实账户授权、令牌刷新及线上读写仍需对应账号验收；本地替身测试、CI 与 Release 成功不替代这些验证，当前状态见[验收边界](./specs/AUTOMATION.md)。

← 返回 [功能文档总览](./index.md)
