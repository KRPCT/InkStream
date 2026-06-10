# 01 应用骨架与三模式 Workbench 验收规范

> 用户视角 ATDD 验收清单。每项标注验证方式：
> **自动** = 对应单元/组件测试文件（`pnpm test` 全绿即覆盖）；**人工** = 真实窗口操作步骤。
> 本规范是阶段验收的唯一对照表，后续阶段的回归核验也以此为基线。

## 1. 启动与五插槽布局

- [ ] 启动桌面应用后，一屏内可见全部五个插槽：TitleBar（顶部自绘标题栏）/ Sidebar（左侧栏）/ EditorArea（中央编辑区）/ RightPanel（右侧面板）/ StatusBar（底部状态栏）。
  - 验证：自动 `src/components/workbench/WorkbenchLayout.test.tsx`；人工 `pnpm tauri dev` 启动目视核对。
- [ ] 拖拽 Sidebar 与 RightPanel 的分隔条可调整面板宽度，宽度在合法区间内（Sidebar 200-480px，RightPanel 240-560px）。
  - 验证：自动 `src/stores/useWorkbenchStore.test.ts`（钳制断言）；人工拖拽到极限位置确认不破版。
- [ ] Sidebar / RightPanel 可折叠与展开，折叠状态不影响其余插槽布局。
  - 验证：自动 `src/stores/useWorkbenchStore.test.ts`；人工 Ctrl+B / Ctrl+Alt+B 往返切换。
- [ ] EditorArea 在无文档时显示欢迎页（应用名 + 快捷键提示表），无任何乱码或占位英文。
  - 验证：人工目视核对（文案为简体中文）。

## 2. 三模式运行时切换

- [ ] 打开命令面板，执行「模式：切换到 Academic（学术）」，布局预设（面板可见性、RightPanel tab 集）与强调色立即变为学院深蓝；「模式：切换到 Creative（长篇创作）」变为朱砂红；「模式：切换到 Standard（通用）」回到石墨灰。
  - 验证：自动 `src/modes/presets.test.ts`、`src/commands/builtins.test.ts`；人工依次执行三命令目视核对。
- [ ] 模式切换不重建窗口、不丢失任何已打开内容：切换前在 EditorArea 区域的状态（含面板宽度调整）切换后仍保留各自模式记忆。
  - 验证：自动 `src/components/workbench/WorkbenchLayout.test.tsx`（EditorArea 不卸载断言）；人工调宽后往返切换核对。
- [ ] StatusBar 模式指示器实时显示当前模式名，与实际布局一致。
  - 验证：自动 `src/components/workbench/ModeIndicator.test.tsx`；人工切换时目视核对。
- [ ] RightPanel 的 tab 集随模式变化：Standard（大纲/反链/局部图谱）、Academic（引用/Typst 预览/大纲）、Creative（Codex/场景概要），各 tab 空态文案为简体中文。
  - 验证：自动 `src/components/workbench/RightPanel.test.tsx`；人工逐模式目视核对。

## 3. 主题与对比度（6 组合 WCAG）

- [ ] 主题三态可用：命令面板执行「主题：亮色」「主题：暗色」「主题：跟随系统」三条命令，界面即时响应；跟随系统时随操作系统主题实时变化。
  - 验证：自动 `src/stores/useSettingsStore.test.ts`；人工切换系统主题观察跟随。
- [ ] 3 模式 x 2 亮暗 = 6 组合的强调色与主题变量值全部正确（CSS 变量层，Obsidian 命名习惯，Atom one-dark/one-light 取值）。
  - 验证：自动 `src/styles/theme.test.ts`（6 组合变量断言）。
- [ ] 右侧标签栏 active 态对比度达标：标签文本 4.5:1 门、accent 指示条 3:1 门（非文本组件），8 项检查全部通过：

  | 检查项 | 门槛 | 验证 |
  |--------|------|------|
  | active tab 标签文本（亮，全模式同值） | 4.5:1 | 自动 `src/styles/contrast.test.ts` |
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
- [ ] 已注册命令全集（12 条）可在面板中检索到：模式 x3、主题 x3、视图 x4（切换侧边栏/切换右侧面板/重置当前模式布局/命令面板）、应用：退出、帮助：关于 InkStream，显示名为「类别：动作」命名法简体中文。
  - 验证：自动 `src/commands/builtins.test.ts`；人工滚动面板全列表核对。

## 5. 中文 IME 防御

- [ ] 拼音组合输入过程中按 Ctrl+B 等快捷键不触发命令分发（含旧引擎/WebView 的 keyCode 229 路径）。
  - 验证：自动 `src/commands/keymap.test.ts`（isComposing 与 keyCode 229 短路用例）。
- [ ] 命令面板输入框中，IME 组合上屏的 Enter 不执行选中命令，仅完成组合。
  - 验证：自动 `src/components/palette/CommandPalette.test.tsx`（isComposing Enter 与 keyCode 229 Enter 用例）；人工以中文输入法在面板内输入并上屏核对。

## 6. 持久化与恢复

- [ ] 重启应用后原样恢复：主题三态、上次模式、三模式各自布局（面板宽度/折叠）、命令 MRU 顺序。
  - 验证：自动 `src/stores/persistSettings.test.ts`；人工「改状态 → 重启 → 核对」。
- [ ] 手写损坏的 settings.json（非法枚举、超界宽度、异型结构）后启动：应用回落默认配置正常可用，并出现错误 toast「无法读取上次的布局配置，已恢复默认布局。」
  - 验证：自动 `src/stores/validateSettings.test.ts`（投毒输入收敛用例）；人工手改配置文件后重启核对。
- [ ] 配置写盘失败时出现警告 toast「布局配置保存失败，本次更改在重启后可能丢失。」，UI 不中断。
  - 验证：自动 `src/stores/persistSettings.test.ts`（写失败路径文案逐字断言）。
- [ ] 频繁调整布局不产生高频磁盘写入（500ms 防抖合并落盘）。
  - 验证：自动 `src/stores/persistSettings.test.ts`（防抖窗口内多次变更单次落盘断言）。

## 7. IPC 与 Channel 红线（立约条目）

- [ ] 全项目仅 `src/ipc/` 目录触达 `@tauri-apps/api` 与 Tauri 插件 API，其余模块经类型化封装调用。
  - 验证：自动 ESLint `no-restricted-imports` 规则（`pnpm lint` 全绿即覆盖）。
- [ ] **红线**：单次 invoke 负载 > 1MB（序列化后 1,048,576 字节）必须改走 Channel（`invokeStreamed`），禁止单条 JSON 消息直传。判定与机理见 `src/ipc/README.md`。
  - 验证：code review 引用条目——后续任何引入大负载 IPC 的变更，评审时对照本条与 `src/ipc/README.md`；运行时断言在出现首个真实大负载的阶段落地。

## 8. 平台行为

- [ ] Windows：自绘标题栏空白区按住可拖动窗口；双击标题栏在最大化/还原间切换；最小化/最大化/关闭三按钮行为正确。
  - 验证：自动 `src/components/workbench/TitleBar.test.tsx`、`src/ipc/window.test.ts`（控制调用断言）；人工真窗口逐项操作。
- [ ] 窗口几何持久化且离屏兜底：拔掉外接显示器后启动，窗口自动回到主屏中央而非停留在不可见区域（含负坐标位置）。
  - 验证：自动 `src-tauri/src/window_guard.rs` 单元测试（`cargo test`，含负坐标用例）；人工改写窗口位置到离屏坐标后启动核对。
- [ ] 三平台构建冒烟：ubuntu / windows / macos 三平台 CI 上 install → typecheck → lint → test → build → cargo check 全绿。
  - 验证：自动 `.github/workflows/ci.yml`（GitHub Actions matrix 运行结果）。

## 9. 已知偏差

- [ ] **macOS Cmd（Meta）修饰键映射推迟**：本阶段快捷键解析仅覆盖 Ctrl / Alt / Shift 修饰键，macOS 上以 Cmd 为主修饰键的等价映射（如 Cmd+Shift+P）暂未实现，待 macOS 实机交互测试阶段补齐后回收本条。代码标记：`src/commands/keymap.ts` 内 `DEVIATION(D-05)` 注释。
  - 验证：存在性核对——`grep "DEVIATION(D-05)" src/commands/keymap.ts` 命中即偏差仍在登记；补齐实现并删除标记后，本条改为常规快捷键验收项。
