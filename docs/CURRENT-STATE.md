# 当前状态与证据

核对日期：2026-09-13。当前版本配置为 **2.1.0**，用户已确认合并并发布。合并记录见 [PR 49](https://github.com/KRPCT/InkStream/pull/49)，安装包和自动更新清单见 [2.1.0 发行页](https://github.com/KRPCT/InkStream/releases/tag/v2.1.0)；实际就绪状态以上述页面为准。

## 2.0.0 历史发布基线

- [PR 40](https://github.com/KRPCT/InkStream/pull/40) 已合并。项目档案、独立会话/草稿、本机索引及文稿/Git/学术流程修复已进入 2.0.0。
- 图标采用用户选定的双层竖板与墨带 SVG。项目 popup 使用纸白、石墨灰、灰绿，已清理两处装饰英文。
- 「视图」菜单实时勾选反馈打字机和专注模式，应用内更新公告包含 2.0.0。
- [合并前 CI](https://github.com/KRPCT/InkStream/actions/runs/34709938076)、[main CI](https://github.com/KRPCT/InkStream/actions/runs/34710877435)、[Release](https://github.com/KRPCT/InkStream/actions/runs/34710891782) 均通过。
- Windows x64、macOS Apple Silicon、Linux x64 安装包及自动更新清单已发布。自动更新载荷签名不等于操作系统发行者代码签名。

## 尚需专项验收

24 个等待合并的实现票已关闭。以下 11 个专项票仍开放，发布或 CI 通过不取代其验收。

| 范围 | 入口 | 尚需证据 |
| --- | --- | --- |
| 大文档 | [响应性契约](https://github.com/KRPCT/InkStream/issues/14) | 代表性输入的端到端耗时与峰值内存 |
| 整体 v1 | [逐项验收](https://github.com/KRPCT/InkStream/issues/25) | 组合流程、原生输入与平台矩阵 |
| Typst | [编译与预览](https://github.com/KRPCT/InkStream/issues/26) | 连续编辑、切文档、失败修正的真实渲染 |
| 文献 | [格式与联动](https://github.com/KRPCT/InkStream/issues/29) | 类型/缺字段矩阵、真实库联动 |
| 真实账户 | [Device Flow](https://github.com/KRPCT/InkStream/issues/36)、[评论线程](https://github.com/KRPCT/InkStream/issues/37) | OAuth/keyring、真实权限和获授权的发送 |
| 主题 | [导入与回退](https://github.com/KRPCT/InkStream/issues/38) | 真实主题与新工作台可读性 |
| 光学与平台 | [CSS/WebGL 与降级](https://github.com/KRPCT/InkStream/issues/39) | 原生 WebView、GPU、缩放及长时表现 |
| UI | [原型差距](https://github.com/KRPCT/InkStream/issues/41) | 本轮多栏已实现并完成 Windows ComputerUse；严格并排对照和密集项目矩阵继续保留 |
| 图标/popup | [SVG 图标](https://github.com/KRPCT/InkStream/issues/42)、[项目弹窗](https://github.com/KRPCT/InkStream/issues/43) | 已补 Windows 亮暗工作台/浮层证据；安装图标与完整弹窗矩阵继续保留 |

## 本轮顺序与证据

[任务地图](https://github.com/KRPCT/InkStream/issues/45)：文档/issues 同步 → DDD/BDD 多栏实现 → 自动测试 → ComputerUse 用户验收。用户已要求实施；旧“仅规划”“全部外部验收后才做 UI”已被后续指令覆盖。

历史审计、旧计划和旧验证文件只代表各自日期。原型的示例数字与假数据不构成产品事实。Vitest、原生测试、浏览器和 ComputerUse 分别说明边界；ComputerUse 不自动证明物理 IME 或其它系统已通过。

实施工作树为 `D:/Github/InkStream-workbench-v2`；`D:/Github/InkStream` 保留用户测试分支的未提交代码。

## 多栏分支完成状态

已实现项目轨、概览／文稿／文献／版本目的地、文献详情与明确插入、键盘标签导航、布局和显示收敛。1910 项前端断言、41 项显式绑定、类型/Lint/前端/原生构建通过；三轮 ComputerUse 已完成并清理进程。实际截图、发现与修复、证据限制见 [验收记录](WORKBENCH-ACCEPTANCE.md)。这些工作台行为验收对应开发提交 `09b32ff`，其[三平台 CI](https://github.com/KRPCT/InkStream/actions/runs/34719252134)已通过；2.1.0 追加版本与发行说明。后续发布由用户明确授权，合并与发行入口见本页顶部。
