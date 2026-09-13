# BDD 自动化绑定状态

本目录的 `.feature` 是用户行为规格。`pnpm test:acceptance` 通过[人工映射](../../scripts/acceptance/bindings.mjs)运行现有 Vitest 检查，**不会解释或执行 Gherkin**。Scenario Outline 的一行通过不代表其余 Examples 已通过。

```text
pnpm test:acceptance
```

命令只选择映射中的具体测试名，串行运行，测试进程硬上限 300 秒；盘点/终止辅助命令各有 10 秒上限。检查测试文件与场景名称是否仍存在，并解析当次新生成的 Vitest JSON：每个选择项必须恰好出现一次且状态为 `passed`；报告缺失、测试未发现、skip/todo、失败、超时或清理未确认都不会被当作通过。未绑定场景不因同文件其它测试绿色而改变状态。

当前命令选择 14 个文件中的 41 项检查：原有 DocumentSession、WorkspaceSession、文件身份迁移、Wiki 导航与补全共 24 项，以及新增多栏工作台 17 项。工作台映射见 [workbench-bindings.mjs](../../scripts/acceptance/workbench-bindings.mjs)，覆盖 WB-01 至 WB-08 的已绑定行为；真实窗口观察见 [ComputerUse 验收](../WORKBENCH-ACCEPTANCE.md)。已校正三条过时的工作区测试名，缺失名称仍会使 runner 失败。`pnpm test` 是直接 `vitest run`；CI 使用 `pnpm test:ci` 的有界 runner，不按本有限映射排除其他测试，也不另行调用 `test:acceptance` 重跑这些选择项。

`test:ci` 先串行运行功能测试（排除两份性能文件，进程上限 780 秒），再单独运行 `blockField.performance.test.ts` 与 `perf.test.ts`（fork 进程、显式 GC，进程上限 60 秒）。两阶段均使用单 worker、关闭文件并行，不提高测试自身的时限；阶段结果和清理记录合并后才形成完整前端检查结论。性能文件必须被发现、有实际断言且全部通过，不能用跳过文件换取绿色结果。

这些集成测试使用真实应用模块、状态、CodeMirror 或工作区流程；边界替身按各测试声明使用。它们不能代替原生 WebView/IME、真实磁盘故障、OS watcher 或外部服务验收。运行后只报告“选择的检查通过”，`bddCompletion` 固定为 `false`；全部 BDD 完成仍须逐项补齐下表。

## 场景与剩余工作

`partial` 表示部分断言已有检查关联；`pending` 表示完整场景尚未绑定到本命令。两者均不是“场景通过”。最新具体测试名及剩余断言以人工映射中的 `checks` / `gap` 字段为准。

| 编号 | 规格场景 | 状态 | 尚缺的关键证据 |
|---|---|---|---|
| DOC-01 | 关闭活动 A 后继续编辑的是 B | partial | 补充输入后保存、A 文件不变及真实落盘 |
| DOC-02 | 未成功保存时关闭请求保留正文 | partial | 冲突 Examples 行和明确反馈断言 |
| DOC-03 | 保留我的内容写入失败后仍可继续裁决冲突 | partial | 再次裁决、失败后自动保存约束贯通 |
| DOC-04 | v1 保存期间产生的 v2 仍需保存 | partial | 退出提示及真实磁盘失败 |
| DOC-05 | 干净后台文档外部更新后显示新版本 | partial | 真实 watcher/文件系统往返 |
| DOC-06 | 后台文档有未保存修改时外部更新不得静默覆盖 | pending | 完整后台脏文档场景 |
| DOC-07 | 文件改名或移动后继续保存到新的位置 | partial | 单文件移动 Examples、编辑撤销历史、各行最终落盘 |
| DOC-08 | 删除已保存文档后自动保存不复活旧路径 | pending | “全部已保存”前置与文件树断言；已有脏文档删除回归不替代 |
| DOC-09 | 选择同名链接候选后保留所选文件身份 | partial | 将补全产物与实际点击串在一次场景中 |
| DOC-10 | 双向链接定位到标题或文本块 | partial | 原生滚动可见性与裸 `^block` 的实际手势示例 |
| WS-01 | 连续选择工作区后迟到结果不得覆盖最终选择 | partial | 旧文档保存及迟到搜索结果组合 |
| WS-02 | 切换失败后原工作区继续接收外部修改 | partial | 真实外部事件抵达原编辑缓冲 |
| WS-03 | 旧工作区搜索结果不能用于新工作区替换 | pending | 搜索命中到替换文件的贯通绑定 |
| WS-04 | 经简易模式切库后索引仍按工作区隔离 | pending | 两库真实索引写入与查询 |
| WS-05 | 简易模式打开新工作区不创建索引目录 | pending | 真实磁盘目录未创建 |
| WS-06 | 禁用当前视图的能力后回到原文档 | pending | 五行 Examples 带正文与继续编辑的完整绑定 |
| WS-07 | 索引提交后关系面板反映新增链接 | pending | 同次提交到反链与局部图谱的贯通绑定 |
| WS-08 | 关系查询失败不伪装成没有关系 | pending | 已有面板/索引测试尚待审定完整场景绑定 |

Save As、删除脏文档、目录移动撤销、旧路径在途写、文件操作失败、Wiki 歧义与创建取消等选择项还提供补充回归证据。没有对应完整 Gherkin 场景时，不借此标记其它场景完成。

## Unix 权限：负控与生产断言分开

Windows、Linux、macOS CI 调用 `node scripts/acceptance/run-rust.mjs`，实际执行：

```text
cargo test --locked --manifest-path src-tauri/Cargo.toml --all-targets -- --test-threads=1
```

[原生 runner](../../scripts/acceptance/run-rust.mjs)给该命令 20 分钟硬上限。`--all-targets` 同时编译库、测试及应用二进制目标；CI 不再单独跑 `cargo check`，也不缩为 `--lib`。Unix 输出必须出现正式 `files::tests::write_file_atomic_preserves_existing_unix_permissions` 的通过记录。该测试验证生产写入路径；Windows 的 `cfg(unix)` 排除明确记为未执行，不算权限验证。

[独立负控](../../scripts/acceptance/unix-permission-negative.rs)只用 Rust 标准库，在本次新建的临时目录重现旧 `File::create → write → sync → rename` 成功写入策略。它不运行旧应用二进制、不包含旧应用其它组件，也不替换正式测试。它记录 `0600` 与 `0751` 的目标权限和实际权限；至少一个权限谓词被违反时输出确认标记并以专用退出码 `42` 退出。

[负控 runner](../../scripts/acceptance/run-unix-negative.mjs)仅把“退出码 42 + 确认标记”分类为预期负控；编译失败、其它退出码、超时或未观察到差异均失败。编译上限 90 秒，执行上限 10 秒；编译产物及案例文件都在本次专属临时目录，结束清理。Windows 不运行此 Unix fixture。即使独立负控失败，未被取消的 CI 仍尝试正式 Rust 测试，不把负控的预期失败包装成正式测试通过。

## 证据与进程责任

每次命令创建新的 `coverage/acceptance/<类型>-<平台>-<时间>-<PID>/`，不存在复用旧 JSON 假绿的路径。目录位于既有 `coverage/` 忽略范围，CI 通过已锁 SHA 的官方 upload-artifact 上传；不改发布 workflow。

- `*-process.json`：命令、参数、PID/父 PID、工作目录、起止时间、超时与清理结果；启动时先写一份记录。
- `*-before/after.json`：OS 进程盘点，包含盘点探针自身命令/PID/时间/10 秒上限。OS 没提供的工作目录保留为 unknown，不臆测。
- `*-idle-*.json`：连续 60 秒无输出时的进程诊断。
- `*-after-cleanup.json`：发现属于本次进程组/可追溯父子链的残留后，记录清理复查；既有或归属不明进程不终止。
- 有限映射 runner 的 `vitest.json` 与 `acceptance-summary.json`：原始测试结果及逐项匹配，保留 partial/pending 状态。
- 完整前端 runner 的 `functional.json`、`performance.json`、合并 `vitest.json` 与 `tests-summary.json`：分阶段结果、发现的断言和清理结论。
- `rust-summary.json` 与 `negative-control-summary.json`：生产 Rust 结果和隔离旧策略负控各自的证据边界。

正常退出、失败、超时及中断均检查可观察的所属进程树；Windows 用明确 PID 的 `taskkill /T`，Unix 用该次新建的进程组。主动脱离父子链/进程组的未知进程不被推定为本次所有，相关限制写入记录。文件存在本身不构成运行通过声明，必须读取对应执行的报告。

## 2.1.0 合并与发布验证

多栏行为由开发提交 `09b32ff` 验收：1910 项前端断言、41 项显式行为绑定及三轮 Windows ComputerUse，范围见[工作台验收记录](../WORKBENCH-ACCEPTANCE.md)。追加版本与软件内公告的发布提交 `a0c98ff` 已通过[三平台 CI](https://github.com/KRPCT/InkStream/actions/runs/34737464772)，经 [PR 49](https://github.com/KRPCT/InkStream/pull/49) 合并 main。合并后的 README 与状态更新仅涉及文档。2.1.0 安装包和签名更新清单的就绪状态见[发行页](https://github.com/KRPCT/InkStream/releases/tag/v2.1.0)。

以下旧发布证据与未完成场景继续保留，不能由新版本号代替验收。

## 2.0.0 历史发布记录与剩余验收

2.0.0 的历史发布基线为 `main` / `v2.0.0` / `ca4c214`，[PR #40](https://github.com/KRPCT/InkStream/pull/40) 已合并，[2.0.0 Release](https://github.com/KRPCT/InkStream/releases/tag/v2.0.0) 已公开：

| 执行 | 结果 | 证据范围 |
|---|---|---|
| [合并前 CI 34709938076](https://github.com/KRPCT/InkStream/actions/runs/34709938076) | success | 对应提交的三平台 CI 步骤 |
| [main CI 34710877435](https://github.com/KRPCT/InkStream/actions/runs/34710877435) | success | 合并后 main 的三平台 CI 步骤 |
| [Release 34710891782](https://github.com/KRPCT/InkStream/actions/runs/34710891782) | success | 安装包、更新签名条目与清单聚合发布 |

[CI 工作流](../../.github/workflows/ci.yml)执行锁文件安装、类型检查、lint、`test:ci`、前端 build、独立 Unix 负控与 Rust 全目标测试。[Release 工作流](../../.github/workflows/release.yml)执行打包与发布，不单独承担完整测试或真实用户验收。标签发布先保留草稿，三平台更新签名与 `latest.json` 就绪后公开；手动触发仅上传 run artifacts，不创建公开 Release。

24 张已实现票已关闭；仍开放的 validation 票为 [#14](https://github.com/KRPCT/InkStream/issues/14)、[#25](https://github.com/KRPCT/InkStream/issues/25)、[#26](https://github.com/KRPCT/InkStream/issues/26)、[#29](https://github.com/KRPCT/InkStream/issues/29)、[#36](https://github.com/KRPCT/InkStream/issues/36)、[#37](https://github.com/KRPCT/InkStream/issues/37)、[#38](https://github.com/KRPCT/InkStream/issues/38)、[#39](https://github.com/KRPCT/InkStream/issues/39)、[#41](https://github.com/KRPCT/InkStream/issues/41)、[#42](https://github.com/KRPCT/InkStream/issues/42)、[#43](https://github.com/KRPCT/InkStream/issues/43)。实现票关闭不改变本表的 BDD partial/pending 状态。

外部真实账号、物理 IME、跨平台完整视觉／性能和安装升级体验需要各自的实际证据。CI success 与公开发布都不能作为这些事项已完成的依据；本规范不将任何未执行的 Gherkin 或真机清单勾为通过。
