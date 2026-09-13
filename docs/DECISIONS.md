# 已确认决定与当前范围

截至 2026-09-13。词汇见 [CONTEXT](../CONTEXT.md)，实现状态见 [CURRENT-STATE](CURRENT-STATE.md)。

| 决定 | 当前约束 | 来源 |
| --- | --- | --- |
| B+A+C | B 日常写作、A 左侧档案浮层、C 学术资料与正文相邻的工具布局 | [原型选择](https://github.com/KRPCT/InkStream/issues/18) |
| 项目 | 独立身份关联内容目录，Git 根单独识别，无 Git 可写作 | [项目定义](https://github.com/KRPCT/InkStream/issues/17) |
| 切换 | 先保存/暂存草稿，失败停留，成功恢复独立会话；每窗口一个活动项目 | [项目会话](https://github.com/KRPCT/InkStream/issues/22) |
| 数据位置 | 元数据、会话和索引在本机应用数据目录，正文留在内容目录 | 同上 |
| 材料/配色 | 正文安静纸面；导航/工具可有材料层次；纸白、石墨灰、低饱和灰绿 | 原方向及用户 2026-09-13 选择 |
| 图标 | 用户最终选择双层竖板与墨带，SVG 路径/渐变重绘 | [图标任务](https://github.com/KRPCT/InkStream/issues/42) |
| popup | 背景独立重做、清理英文；“仅图标拟物”限定新增拟物改动，不自动撤销整个工作台材料目标 | [弹窗任务](https://github.com/KRPCT/InkStream/issues/43) |
| 顺序 | 用户已允许先完成本地实现与 UI，真实账号验收独立保留 | 后续交接与发布指令 |
| 2.0.0 | 已完成合并 main、推送标签和公开发布 | [PR 40](https://github.com/KRPCT/InkStream/pull/40)、[Release](https://github.com/KRPCT/InkStream/releases/tag/v2.0.0) |
| 本轮 | 先更新文档/issues，按 DDD/BDD 对齐多栏，测试后 ComputerUse 验收 | 当前请求、[任务地图](https://github.com/KRPCT/InkStream/issues/45) |

原型累计字数、目标进度、文献与版本记录是演示数据；产品展示真实状态或明确的空/失败状态。

当前按单一主编辑器与多个工具栏推进。“对齐现有多栏”不自动增加多个文稿同时编辑；新的正文权威或焦点模型需要明确需求。

本轮实现选择：日常版本时间线保留项目导航，高级分支/差异/远端操作仍使用全宽版本管理。新会话采用 220/260px 两侧默认宽度，既有项目记忆不改写。模式菜单使用独立弹出层以兼容状态栏横向滚动；文献详情可滚动，插入操作常驻底部。原生发现与修复见 [验收记录](WORKBENCH-ACCEPTANCE.md)。

2026-09-13 后续决定：用户确认将已验收多栏实现合并 main，并采用 **2.1.0** 发布。该授权替代开发阶段暂不合并/发布的范围。版本与公告同步后，发布链路以 [PR 49](https://github.com/KRPCT/InkStream/pull/49) 和 [Release](https://github.com/KRPCT/InkStream/releases/tag/v2.1.0) 留证。
