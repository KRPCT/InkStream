# BDD 自动化绑定状态

本目录的 `.feature` 是用户行为规格。`pnpm test:acceptance` 通过[人工映射](../../scripts/acceptance/bindings.mjs)运行现有 Vitest 检查，**不会解释或执行 Gherkin**。Scenario Outline 的一行通过不代表其余 Examples 已通过。

```text
pnpm test:acceptance
```

命令只选择映射中的具体测试名，串行运行，测试进程硬上限 300 秒；盘点/终止辅助命令各有 10 秒上限。检查测试文件与场景名称是否仍存在，并解析当次新生成的 Vitest JSON：每个选择项必须恰好出现一次且状态为 `passed`；报告缺失、测试未发现、skip/todo、失败、超时或清理未确认都不会被当作通过。未绑定场景不因同文件其它测试绿色而改变状态。

当前命令选择五个文件中的 24 项检查：DocumentSession、WorkspaceSession、文件身份迁移、Wiki 实际导航，以及一项同名候选补全检查。既有完整 `pnpm test` 与 CI 的完整 Vitest 步骤保留，不按这份有限映射排除任何测试；CI 不重复运行同一批 Vitest，只新增原生 Rust 验证。

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

CI 保留 `cargo check`，并在 Windows、Linux、macOS 实际执行：

```text
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1
```

[原生 runner](../../scripts/acceptance/run-rust.mjs)给该命令 20 分钟硬上限，并在 Unix 输出中要求观察到正式 `files::tests::write_file_atomic_preserves_existing_unix_permissions` 的通过记录。该正式测试保持原有断言，验证生产 `files.rs` 的写入结果；Windows 的 `cfg(unix)` 排除明确记为未执行，不算权限验证。

[独立负控](../../scripts/acceptance/unix-permission-negative.rs)只用 Rust 标准库，在本次新建的临时目录重现旧 `File::create → write → sync → rename` 成功写入策略。它不运行旧应用二进制、不包含旧应用其它组件，也不替换正式测试。它记录 `0600` 与 `0751` 的目标权限和实际权限；至少一个权限谓词被违反时输出确认标记并以专用退出码 `42` 退出。

[负控 runner](../../scripts/acceptance/run-unix-negative.mjs)仅把“退出码 42 + 确认标记”分类为预期负控；编译失败、其它退出码、超时或未观察到差异均失败。编译上限 90 秒，执行上限 10 秒；编译产物及案例文件都在本次专属临时目录，结束清理。Windows 不运行此 Unix fixture。即使独立负控失败，未被取消的 CI 仍尝试正式 Rust 测试，不把负控的预期失败包装成正式测试通过。

## 证据与进程责任

每次命令创建新的 `coverage/acceptance/<类型>-<平台>-<时间>-<PID>/`，不存在复用旧 JSON 假绿的路径。目录位于既有 `coverage/` 忽略范围，CI 通过已锁 SHA 的官方 upload-artifact 上传；不改发布 workflow。

- `*-process.json`：命令、参数、PID/父 PID、工作目录、起止时间、超时与清理结果；启动时先写一份记录。
- `*-before/after.json`：OS 进程盘点，包含盘点探针自身命令/PID/时间/10 秒上限。OS 没提供的工作目录保留为 unknown，不臆测。
- `*-idle-*.json`：连续 60 秒无输出时的进程诊断。
- `*-after-cleanup.json`：发现属于本次进程组/可追溯父子链的残留后，记录清理复查；既有或归属不明进程不终止。
- `vitest.json` 与 `acceptance-summary.json`：原始测试结果及逐项匹配，保留 partial/pending 状态。
- `rust-summary.json` 与 `negative-control-summary.json`：生产 Rust 结果和隔离旧策略负控各自的证据边界。

正常退出、失败、超时及中断均检查可观察的所属进程树；Windows 用明确 PID 的 `taskkill /T`，Unix 用该次新建的进程组。主动脱离父子链/进程组的未知进程不被推定为本次所有，相关限制写入记录。此设施尚需主 Agent 实际运行审查；文件存在不构成运行通过声明。
