<h1 align="center">InkStream / 墨流</h1>

<p align="center"><b>单内核 · 三模式 · git 原生的桌面写作应用 —— 文本编辑器中的 IntelliJ</b></p>
<p align="center">一个 App 写论文、写小说、写文档：内置 Zotero 引用、Obsidian 式双向链接、Typst / LaTeX / KaTeX 数学排版、完整 git 图谱与句级 prose diff，无需拼装任何插件。</p>

<p align="center">
  <a href="https://github.com/KRPCT/InkStream/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/KRPCT/InkStream?style=flat-square&color=3b8774&label=release"></a>
  <a href="https://github.com/KRPCT/InkStream/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/KRPCT/InkStream/total?style=flat-square&color=3b8774"></a>
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white">
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="CodeMirror 6" src="https://img.shields.io/badge/CodeMirror-6-d30707?style=flat-square">
  <a href="https://github.com/KRPCT/InkStream/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/KRPCT/InkStream?style=flat-square&color=f5c518"></a>
</p>

<p align="center">
  <a href="#特性">特性</a> ·
  <a href="#下载安装">下载安装</a> ·
  <a href="#三模式">三模式</a> ·
  <a href="docs/index.md">功能文档</a> ·
  <a href="#技术栈">技术栈</a> ·
  <a href="#从源码构建">从源码构建</a> ·
  <a href="#路线图">路线图</a> ·
  <a href="#star-趋势">Star 趋势</a> ·
  <a href="#赞助">赞助</a>
</p>

<p align="center">
  <a href="https://github.com/KRPCT/InkStream/releases/latest"><b>↓ 下载最新版（Windows / macOS / Linux）</b></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="docs/index.md"><b>功能文档 / 使用指南 →</b></a>
</p>

---

**InkStream（墨流）** 是一款基于 Tauri 2 的桌面写作应用，定位"文本编辑器中的 IntelliJ"。它在单一 CodeMirror 6 内核之上提供 Standard（通用）/ Academic（学术）/ Creative（长篇创作）三种模式，原生内置 git 版本管理、Obsidian 风格双向链接知识网络、Zotero 学术引用与 Typst / LaTeX / KaTeX 数学渲染——让研究者、创作者与知识工作者不必拼装插件，即可获得专业写作环境。

> 核心价值：**单一 CodeMirror 6 内核 + git 原生**。任何时刻 `state.doc.toString()` 是文档唯一真相源，三种模式只是布局预设与功能集切换——永不绑定文件格式、永不丢数据。

## 目录

- [特性](#特性)
- [下载安装](#下载安装)
- [三模式](#三模式)
- [技术栈](#技术栈)
- [从源码构建](#从源码构建)
- [路线图](#路线图)
- [Star 趋势](#star-趋势)
- [赞助](#赞助)

## 特性

- **单一内核编辑器**：全 App 一个 CodeMirror 6 实例，纯文本恒为真相源；Source 与 Live Preview 运行时切换，光标所在行自动展开源码；11 种语言高亮，十万字文档装饰构建低于一帧。
- **三类数学原语**：fenced 数学块 math（KaTeX）/ typst（typst.ts wasm 实时 SVG）/ latex（MathJax），全部懒加载，首屏不载入 wasm 与字体。
- **Obsidian 式知识网络**：`[[wiki-link]]` 完整语法（`|alias` / `#heading` / `^block`）、SQLite FTS5 全库索引（中文 trigram 分词）、反链面板（含 unlinked mentions）。
- **知识图谱可视化**：`Ctrl+G` 打开全库 Graph View（d3-force 力导 + Canvas2D 自绘 + 布局 Worker 化），拖拽缩放、点击跳转、邻域高亮、大图自动降级；右栏可看当前文件的局部图谱。
- **git 原生**：Rust libgit2 完整命令集；自绘 SVG 三栏 git-graph（图谱 + 提交详情 + 文件 diff），右键菜单驱动；远程 clone / fetch / push / pull，SSH 签名提交。
- **prose-aware diff 与三向合并**：中英混合句级语义 diff，看到的是"哪句话改了"而非"哪行变了"；合并冲突提供逐块采纳本方 / 对方的 prose 三向解决器。
- **Zotero 学术集成**：CAYW 一键插入 `[@citekey]`、Web API 离线缓存、GB/T 7714 / APA / Vancouver 参考文献、引用与 Typst / LaTeX 自动联动。
- **GitHub 集成**：PAT / gh CLI 登录（token 存 OS 凭据库、绝不进前端）、Issue 与 PR 浏览 / 评论 / 创建、PR review 与内嵌 diff 审阅。
- **创作模式**：章节-场景导航树（状态色点 + 字数）、固定 `Codex/` 角色·地点·设定卡（别名提及高亮 + 悬停卡）、Focus Mode（F11 段落聚焦）、今日字数目标进度、场景概要卡。
- **写作辅助**：打字机模式（光标行居中）、专注模式（淡化非光标段落）、可选写作 HUD 悬浮窗（码字速度 / 码字时间 / 番茄钟），默认关闭、纯内存。
- **文件导出**：当前文档一键导出 HTML / PDF / DOCX，自带「Made with InkStream」标识与元数据；全本地转换，不依赖外部工具或命令行。
- **沉浸阅读模式**：txt / docx / epub / pdf 全屏阅读，自动识别小说 vs 文献并切换排版，亮 / 护眼 / 夜间三配色；PDF 逐页懒渲染、编辑器零卸载随时返回。
- **简易模式**：一键精简——关闭全部高级功能、不在工作区创建 `.inkstream` 索引库，给轻度用户最干净的纯文本编辑。
- **中文优先**：中文 IME 输入全程不被渲染打断、中英混合字数统计、中文模糊搜索。

## 下载安装

前往 **[Releases](https://github.com/KRPCT/InkStream/releases/latest)** 下载对应平台安装包：

| 平台 | 安装包 |
|------|--------|
| Windows | `InkStream_*_x64-setup.exe`（NSIS 安装器） |
| macOS（Apple Silicon） | `InkStream_*_aarch64.dmg` |
| Linux | `InkStream_*_amd64.deb` / `InkStream_*_amd64.AppImage` |

> **首次运行提示**：当前版本尚未做代码签名。Windows 在 SmartScreen 选「更多信息 → 仍要运行」；macOS 右键图标 →「打开」绕过 Gatekeeper；Linux 的 AppImage `chmod +x` 后双击运行。

## 三模式

三模式 = UI 布局预设 + 默认功能集 + 状态栏指标。不限制文件内容、不绑定文件格式，随时切换不丢数据。

| 模式 | 定位 | 强调色 | 特色 |
|------|------|--------|------|
| Standard | 通用文本编辑 | 石墨灰 | 文件树、大纲 / 反链 / 局部图谱、Live Preview |
| Academic | 学术写作 | 学院深蓝 | Zotero 文献库、Citation Panel、Typst 预览、学术工具栏 |
| Creative | 长篇创作 | 朱砂红 | 章节导航树、Codex、Focus Mode、字数目标进度 |

## 技术栈

| 层 | 选型 |
|----|------|
| 桌面壳 | Tauri 2（Rust + Web，体积优先） |
| 前端 | React 19 + TypeScript strict + Zustand 5 |
| 样式 | Tailwind 4（布局）+ 原生 CSS 变量（主题，Obsidian 命名习惯） |
| 编辑器内核 | CodeMirror 6 + @lezer/markdown（单实例单内核 + 三层装饰范式 + 统一 IME 冻结门） |
| 数学排版 | KaTeX / @myriaddreamin/typst.ts (wasm) / MathJax |
| 知识图谱 | d3-force 力导 + Canvas2D 自绘（布局 Worker 化） |
| Git / GitHub | git2 (libgit2 Rust binding) / Rust reqwest 直连 GitHub REST + keyring |
| 全文索引 | SQLite FTS5（Rust 端单写入队列，中文 trigram 分词） |

> 依赖全部**精确锁版本**（无 `^` / `~` / `latest`），供应链零信任。

## 从源码构建

环境要求：**Node 22（LTS）· Rust stable（rustup）· pnpm 11.5.2**（经 corepack 激活）。

```bash
corepack enable
pnpm install          # 精确版本锁定
pnpm tauri dev        # 开发模式启动桌面应用
pnpm tauri build      # 打包本平台安装包（产物在 src-tauri/target/release/bundle/）
```

三道门：`pnpm typecheck && pnpm lint && pnpm test`。Linux 构建需先安装 webkit2gtk 等系统依赖（清单见 [.github/workflows/ci.yml](./.github/workflows/ci.yml)）；三平台安装包经 [.github/workflows/release.yml](./.github/workflows/release.yml) 在 CI 同时构建。

## 路线图

v1 共 12 个阶段，已全部交付：

- [x] 应用骨架与三模式 Workbench · 命令面板 · 主题三态
- [x] CM6 单内核 · 11 语言高亮 · 工作区文件 · 快速打开
- [x] Live Preview 装饰层 · 中文 IME 冻结门
- [x] FTS5 全库索引 · wiki-link 全语法 · 反链面板
- [x] Fenced 三原语：math / typst / latex
- [x] git 原生 · 自绘三栏 git-graph
- [x] prose-aware 句级 diff
- [x] Zotero 集成 · Academic 模式
- [x] Creative 模式 · Codex · Focus Mode
- [x] 知识 Graph View · Standard 模式完整
- [x] GitHub 集成（Issue / PR / review / diff）
- [x] prose 三向合并 · 三模式总装 · 跨平台打包发布

后续计划：

- [ ] 应用内自动更新（updater，签名密钥就绪后）
- [ ] 代码签名（Windows Authenticode / macOS 公证）
- [ ] macOS Intel（x86_64）构建
- [ ] Graph View WebGL 渲染（超大 vault）

v1 范围外（明确不做）：实时多人协作、移动端、插件市场、内置 AI 写作、成为代码 IDE、复刻 Obsidian 插件 API。

## Star 趋势

如果 InkStream 对你有帮助，欢迎点一个 Star——这是对独立开发最直接的鼓励。

<a href="https://star-history.com/#KRPCT/InkStream&Date">
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=KRPCT/InkStream&type=Date" width="640">
</a>

## 赞助

InkStream 由个人利用业余时间开发与维护，**免费、开源、无订阅、无广告**。如果它替你省下了一份写作 / 笔记软件的订阅，或你希望它继续做下去，欢迎请作者喝杯咖啡——完全自愿，与功能访问无关。

<table>
  <tr>
    <td align="center" width="320">
      <img src="docs/assets/donate-wechat.jpg" alt="微信支付" width="260"><br>
      <b>微信支付</b>
    </td>
    <td align="center" width="320">
      <img src="docs/assets/donate-alipay.jpg" alt="支付宝" width="260"><br>
      <b>支付宝</b>
    </td>
  </tr>
</table>

---

<p align="center"><i>用一条墨线，流过论文、小说与代码。</i></p>
