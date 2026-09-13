# 01 三模式 Workbench 验收规范（2.1.0）

> 用户视角 ATDD 验收清单。每项标注验证方式：
> **自动** = 指定测试文件中对应行为的断言，需核对实际发现、执行与结果；**人工** = 真实窗口操作步骤。
> `pnpm test` / `test:ci` 通过不等于每条验收或全部 BDD 完成；jsdom 不能证明真实 WebView、物理 IME、跨平台视觉与性能通过。
> 本清单在 `v2.0.0` / `ca4c214` 基线上更新到 2.1.0 多栏行为，勾选须附对应提交证据。它与 [工作台行为规格](../docs/specs/workbench-ux.feature)、[BDD 绑定状态](../docs/specs/AUTOMATION.md)和 [ComputerUse 记录](../docs/WORKBENCH-ACCEPTANCE.md)共同使用；发布范围以 CURRENT-STATE 为准。

## 1. 启动、项目导航与布局

- [ ] 桌面工作台包含顶部标题栏与菜单、左侧项目导航、文件侧栏、中央编辑区、右侧工具和底部状态栏。项目档案作为浮层打开，不推挤正文；面板按当前模式的折叠状态显示，不要求所有区域始终可见。
  - 验证：自动 `src/components/workbench/WorkbenchLayout.test.tsx`、`src/components/workbench/WorkbenchProjects.test.tsx`；人工用桌面窗口核对。
- [ ] `Ctrl+Alt+P`、项目导航按钮及「文件 → 项目档案…」打开同一档案入口；归档层打开或项目切换中，背景编辑区不会继续接受输入。
  - 验证：自动 `src/components/projects/ProjectArchive.test.tsx`、`src/components/workbench/WorkbenchProjects.test.tsx`；人工逐入口核对。
- [ ] 拖拽 Sidebar 与 RightPanel 的分隔条可调整面板宽度，宽度在合法区间内（Sidebar 200-480px，RightPanel 240-560px）。
  - 验证：自动 `src/stores/useWorkbenchStore.test.ts`、`src/components/workbench/WorkbenchLayoutPersistence.test.tsx`、`src/components/workbench/layoutPatch.test.ts`；人工宽窗口拖拽核对。窗口不超过 1100px 时两侧改用抽屉，抽屉几何不得覆盖已记忆栏宽。
- [ ] Sidebar / RightPanel 可折叠与展开，折叠状态不影响其余插槽布局。
  - 验证：自动 `src/stores/useWorkbenchStore.test.ts`；人工 `Ctrl+\` / `Ctrl+Alt+B` 往返切换；`Ctrl+B` 保留为 Markdown 加粗。
- [ ] 无项目且无标签时显示新建文档／打开文件夹入口；已有项目但无活动文件时显示未打开文件空态；独立草稿打开后可继续编辑。
  - 验证：自动 `src/components/workbench/EditorArea.test.tsx`；人工目视核对可操作入口和简体中文文案。
- [ ] 项目导航使用 `inkstream-icon.svg`，工具及菜单勾选使用 SVG 图标；图标入口有可识别名称，亮暗主题下清晰。
  - 验证：静态核对 `ProjectRail.tsx`、`Menu.tsx`、`ModeIndicator.tsx`；人工在桌面窗口核对显示与交互，不以资源存在证明视觉验收。

## 2. 三模式运行时切换

- [ ] 打开命令面板，执行「模式：切换到 Academic（学术）」，布局预设（面板可见性、RightPanel tab 集）立即更新；三个模式均沿用纸白、石墨灰与低饱和灰绿配色，身份由模式名称与当前勾选标记表达。
  - 验证：自动 `src/modes/presets.test.ts`、`src/commands/builtins.test.ts`；人工依次执行三命令目视核对。
- [ ] 模式切换不重建窗口、不丢失任何已打开内容：切换前在 EditorArea 区域的状态（含面板宽度调整）切换后仍保留各自模式记忆。
  - 验证：自动 `src/components/workbench/WorkbenchLayoutPersistence.test.tsx`；人工编辑、调宽后往返切换，核对正文、选区与模式布局。
- [ ] StatusBar 模式指示器实时显示当前模式名，与实际布局一致。
  - 验证：自动 `src/components/workbench/ModeIndicator.test.tsx`；人工核对状态栏右侧入口、当前模式勾选，以及「视图 → 模式」和命令面板入口。
- [ ] RightPanel 的 tab 集随模式变化：Standard（大纲/反链/局部图谱）、Academic（引用/Typst 预览/大纲）、Creative（Codex/场景概要），各 tab 空态文案为简体中文。
  - 验证：自动 `src/components/workbench/RightPanel.test.tsx`；人工逐模式目视核对。

## 3. 主题与对比度（6 组合 WCAG）

- [ ] 主题三态可用：命令面板执行「主题：亮色」「主题：暗色」「主题：跟随系统」三条命令，界面即时响应；跟随系统时随操作系统主题实时变化。
  - 验证：自动 `src/stores/useSettingsStore.test.ts`；人工切换系统主题观察跟随。
- [ ] 3 模式 x 2 亮暗 = 6 组合的强调色与主题变量值全部正确（CSS 语义变量；当前灰绿强调色见 theme.css，语法高亮保留独立语义色）。
  - 验证：自动 `src/styles/theme.test.ts`（6 组合变量断言）。
- [ ] 内置主题右侧标签栏 active 态对比度达标：标签文本 4.5:1 门、accent 指示条 3:1 门（非文本组件）。以下 8 项计算检查不能代替导入主题、透明材质与真实平台的完整视觉核验：

  | 检查项 | 门槛 | 验证 |
  |--------|------|------|
  | active tab 标签文本（亮，全模式同值） | 4.5:1 | 自动 `src/styles/theme.test.ts`（比例计算另见 `contrast.test.ts`） |
  | active tab 标签文本（暗，全模式同值） | 4.5:1 | 同上 |
  | Standard 亮 accent 指示条 | 3:1 | 同上 |
  | Academic 亮 accent 指示条 | 3:1 | 同上 |
  | Creative 亮 accent 指示条 | 3:1 | 同上 |
  | Standard 暗 accent 指示条 | 3:1 | 同上 |
  | Academic 暗 accent 指示条 | 3:1 | 同上 |
  | Creative 暗 accent 指示条 | 3:1 | 同上 |

- [ ] 强调色不作为小字号文本色、不作为大面积背景填充（含低透明度 tint）；选中/hover 背景一律中性变量。
  - 验证：人工逐模式目视核对 + code review（组件只消费语义变量）。
- [ ] 启动无主题闪烁（FOUC）：暗色主题下重启应用，首帧即为暗色，无白闪。
  - 验证：人工暗色主题下连续重启 3 次目视核对。

## 4. 命令面板与命令注册表

- [ ] Ctrl+Shift+P 打开命令面板，输入框预填「>」，placeholder 为「输入命令名称」。
  - 验证：自动 `src/components/palette/CommandPalette.test.tsx`；人工按键核对。
- [ ] 模糊搜索支持中文：输入「学术」「暗色」等子串可命中对应命令；无结果时显示「没有匹配的命令」。
  - 验证：自动 `src/commands/match.test.ts`（CJK 命中用例）；人工输入中文核对。
- [ ] 执行任意已注册命令后，该命令在下次打开时 MRU 置顶。
  - 验证：自动 `src/commands/mru.test.ts`；人工执行后重开面板核对。
- [ ] 命令注册表为统一入口：注册/注销/执行行为正确，重复注册有防御。
  - 验证：自动 `src/commands/registry.test.ts`。
- [ ] 命令面板按注册表及功能开关展示当前可用命令，包括项目、文件、编辑、视图、Git、学术与帮助入口；不再以早期的 12 条骨架命令作为全集。简易模式、pandoc 可用性和书架开关与菜单使用同一过滤规则。
  - 验证：自动 `src/commands/builtins.test.ts`、`src/components/workbench/menuConfig.test.ts`；人工切换开关后核对命令面板和菜单。
- [ ] 「视图」菜单的打字机模式、专注模式显示实时勾选；从命令面板或编辑器 `F11` 改变专注状态后，菜单同步更新。写作 HUD 的状态栏入口反映其开启状态。
  - 验证：核对 `MenuBar.tsx` / `menuConfig.tsx` 与对应组件检查、`src/components/workbench/HudHintIndicator.test.tsx`；人工通过各入口往返核对。

## 5. 中文 IME 防御

- [ ] 拼音组合输入过程中按 `Ctrl+\`、`Ctrl+B` 等快捷键不触发命令分发（含旧引擎/WebView 的 keyCode 229 路径）。
  - 验证：自动 `src/commands/keymap.test.ts`（isComposing 与 keyCode 229 短路用例）。
- [ ] 命令面板输入框中，IME 组合上屏的 Enter 不执行选中命令，仅完成组合。
  - 验证：自动 `src/components/palette/CommandPalette.test.tsx`（isComposing Enter 与 keyCode 229 Enter 用例）；人工以中文输入法在面板内输入并上屏核对。

## 6. 持久化与恢复

- [ ] 重启应用后原样恢复：主题三态、上次模式、三模式各自布局（面板宽度/折叠）、命令 MRU 顺序。
  - 验证：自动 `src/stores/persistSettings.test.ts`、`src/projects/session.test.ts`；人工「改状态 → 重启 → 核对」。项目会话恢复时应用该项目自己的模式与布局，不把全局上次模式当作所有项目的状态。
- [ ] 设置中的非法枚举、超界宽度或异型结构经校验回落合法值；读取／解析失败时回落默认配置，并提示「无法读取上次的布局配置，已恢复默认布局。」
  - 验证：自动 `src/stores/validateSettings.test.ts` 与 `src/stores/persistSettings.test.ts`；人工仅在专用测试配置副本上核对两类失败，不修改用户实际配置。
- [ ] 配置写盘失败时出现警告 toast「布局配置保存失败，本次更改在重启后可能丢失。」，UI 不中断。
  - 验证：自动 `src/stores/persistSettings.test.ts`（写失败路径文案逐字断言）。
- [ ] 频繁调整布局不产生高频磁盘写入（500ms 防抖合并落盘）。
  - 验证：自动 `src/stores/persistSettings.test.ts`（防抖窗口内多次变更单次落盘断言）。
- [ ] 项目档案、封面、会话恢复正文与索引使用本机应用数据目录，内容目录中的既有 `.inkstream` 保留；切换前保存／快照失败时原项目与正文保留。独立草稿、缺失文件恢复副本和「恢复前编辑」按[项目与恢复](../docs/projects.md)处理。
  - 验证：自动 `src/projects/session.test.ts`、`src/projects/session.recovery.test.ts` 和 `src-tauri/src/projects/tests.rs`；人工用测试创建的内容目录核对切换、重启、备份和故障提示。自动替身不代替真实磁盘故障验收。

## 7. IPC 与 Channel 红线（立约条目）

- [ ] 全项目仅 `src/ipc/` 目录触达 `@tauri-apps/api` 与 Tauri 插件 API，其余模块经类型化封装调用。
  - 验证：ESLint `no-restricted-imports` 规则只证明导入边界，不证明具体 IPC 行为或整体验收。
- [ ] 单次 JSON invoke 不超过 1MiB；文件读取走 Channel Raw 分块，写入走 begin / append / commit 会话、逐块确认。数据块最大 256KiB，只有真实提交成功才能清除未保存状态，失败／取消不得误报保存成功。
  - 验证：对照 [IPC 协议](../src/ipc/README.md)、`src/ipc/fileStream.ts`、`src/ipc/fileWrite.ts` 与原生读写测试；真实 WebView 响应性另测。该实现已经存在，不再列作未来大负载阶段的待实现断言。

## 8. 平台行为

- [ ] Windows：自绘标题栏空白区按住可拖动窗口；双击标题栏在最大化/还原间切换；最小化/最大化/关闭三按钮行为正确。
  - 验证：自动 `src/components/workbench/TitleBar.test.tsx`、`src/ipc/window.test.ts`（控制调用断言）；人工真窗口逐项操作。
- [ ] 窗口几何持久化且离屏兜底：拔掉外接显示器后启动，窗口自动回到主屏中央而非停留在不可见区域（含负坐标位置）。
  - 验证：自动 `src-tauri/src/window_guard.rs` 单元测试（`cargo test`，含负坐标用例）；人工改写窗口位置到离屏坐标后启动核对。
- [ ] 三平台 CI 完成锁文件安装 → typecheck → lint → `test:ci` → build → 独立 Unix 负控（仅 Unix）→ `run-rust.mjs` 全目标生产测试。
  - 验证：`.github/workflows/ci.yml` 与对应运行报告。原生实际命令为 `cargo test --locked --manifest-path src-tauri/Cargo.toml --all-targets -- --test-threads=1`，不另跑 `cargo check`；发布记录见 [AUTOMATION.md](../docs/specs/AUTOMATION.md)。三平台 CI 与 Release success 不自动勾选人工或性能项。

## 9. 已知偏差

- [ ] **macOS Cmd（Meta）修饰键映射推迟**：本阶段快捷键解析仅覆盖 Ctrl / Alt / Shift 修饰键，macOS 上以 Cmd 为主修饰键的等价映射（如 Cmd+Shift+P）暂未实现，待 macOS 实机交互测试阶段补齐后回收本条。代码标记：`src/commands/keymap.ts` 内 `DEVIATION(D-05)` 注释。
  - 验证：`rg -n 'DEVIATION\(D-05\)|metaKey|MODIFIER_ORDER' src/commands/keymap.ts` 核对实现；保留偏差直到全局 Cmd 映射与 macOS 真机检查均有证据。编辑器或链接局部支持 Cmd 不代表全局命令已经映射。
