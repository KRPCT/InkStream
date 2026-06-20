<h1 align="center">InkStream / 墨流</h1>

<p align="center"><b>单内核 · 三模式 · git 原生的桌面写作应用</b></p>
<p align="center">一个应用里写论文、写小说、写文档。Zotero 引用、双向链接、Typst / LaTeX / KaTeX 数学排版、git 图谱和句级 diff 都做进了应用本身，不用自己拼插件。</p>

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

**InkStream（墨流）** 是一款基于 Tauri 2 的桌面写作应用。它只用一个 CodeMirror 6 编辑器，提供 Standard（通用）、Academic（学术）、Creative（长篇创作）三种模式；git 版本管理、双向链接、Zotero 引用和 Typst / LaTeX / KaTeX 数学渲染都内置在应用里，而不是交给一堆插件。

如果要一句话概括，它想成为文本编辑器里的 IntelliJ：纯文本的简单，配上 IDE 级的工具。

> 一条原则：**一个内核，以纯文本为准**。任何时刻 `state.doc.toString()` 就是文档本身。三种模式只切换布局和工具，不绑定文件格式，也不会偷偷转换或丢数据。

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

- **单一内核编辑器**：整个应用就一个 CodeMirror 6 实例，纯文本始终是文档的依据。Source 和 Live Preview 随时切换，光标所在行自动展开源码，支持 11 种语言高亮。
- **三类数学块**：math 走 KaTeX，typst 走 typst.ts（wasm 实时 SVG），latex 走 MathJax。都是懒加载，首屏不碰 wasm 和字体。
- **双向链接知识网络**：`[[wiki-link]]` 全语法（`|别名`、`#标题`、`^块`），SQLite FTS5 全库索引，中文按三字分词；反链面板还会列出未链接的提及。
- **知识图谱**：`Ctrl+G` 打开全库 Graph View，d3-force 力导加 Canvas2D 自绘，布局放到 Worker 里跑。可缩放、拖拽、点击跳转、邻域高亮；右栏能看当前文件的局部图谱。
- **git 原生**：基于 libgit2 的完整命令集，自绘三栏 git-graph（图谱、提交详情、文件 diff）。支持远程 clone / fetch / push / pull 和 SSH 签名提交。
- **句级 diff 与三向合并**：中英混排按句子比较，看的是「哪句话改了」而不是「哪行变了」。合并冲突可以逐句采纳本方或对方。
- **Zotero 集成**：CAYW 一键插入 `[@citekey]`，Web API 离线缓存，GB/T 7714 / APA / Vancouver 参考文献，引用与 Typst / LaTeX 联动。
- **GitHub 集成**：PAT 或 gh CLI 登录（token 存进系统钥匙串，不进前端），浏览、评论、创建 Issue 和 PR，内嵌 diff 审阅。
- **创作模式**：章节场景树（带状态色点和字数）、`Codex/` 角色与设定卡（别名提及高亮、悬停预览）、Focus Mode、今日字数目标、场景概要。
- **写作辅助**：打字机模式让光标行居中，专注模式淡化其余段落，写作 HUD 记码字速度、码字时间和番茄钟。默认都关着，只存在内存里。
- **文件导出**：一键把当前文档导出成 HTML、PDF、DOCX，全本地转换；可加一行自定义水印（默认关）。装了 pandoc 还能导出 ODT、LaTeX、EPUB 等。
- **沉浸阅读模式**：打开 txt、docx、epub、pdf 全屏阅读，自动认出小说还是文献并换排版，三套配色护眼。PDF 逐页懒渲染，编辑器不卸载，随时切回来。
- **应用内自动更新**：启动时静默检查新版本，一键下载并重启升级，更新包经签名验证。
- **简易模式**：一键收起全部高级功能，也不在工作区建 `.inkstream` 索引库，给轻度用户最干净的纯文本编辑。
- **中文优先**：中文输入法全程不被预览打断，中英混合字数统计，中文模糊搜索。

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

v1 的 12 个阶段已经全部做完：三模式 Workbench、CM6 单内核与多语言高亮、Live Preview、FTS5 索引与双向链接、三类数学块、git 与 git-graph、句级 diff、Zotero 与学术模式、创作模式、知识图谱、GitHub 集成，以及三向合并和跨平台打包发布。

v1.1 之后又陆续加了简易模式、写作模式升级（打字机 / 专注 / 写作 HUD）、文件导出（含 pandoc 多格式）、沉浸阅读模式，还有应用内自动更新。

还想做的：

- [ ] 代码签名（Windows Authenticode / macOS 公证）
- [ ] macOS Intel（x86_64）构建
- [ ] 超大 vault 的 Graph View 用 WebGL 渲染

不打算做：实时多人协作、移动端、插件市场、内置 AI 写作、变成代码 IDE、复刻 Obsidian 插件 API。

## Star 趋势

如果 InkStream 对你有帮助，欢迎点一个 Star，这是对独立开发最直接的鼓励。

<a href="https://star-history.com/#KRPCT/InkStream&Date">
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=KRPCT/InkStream&type=Date" width="640">
</a>

## 赞助

InkStream 由个人利用业余时间开发与维护，免费、开源、无订阅、无广告。如果它替你省下了一份写作或笔记软件的订阅，或者你希望它继续做下去，欢迎请作者喝杯咖啡。完全自愿，和功能访问没有关系。

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
