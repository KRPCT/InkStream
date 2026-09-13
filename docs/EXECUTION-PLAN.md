# 多栏工作台执行计划

实施起点为 main / 2.0.0 / ca4c214；计划已完成，其实现与 2.1.0 发行配置已由 PR 49 合并 main。工作入口为[任务地图](https://github.com/KRPCT/InkStream/issues/45)。

| 顺序 | 产出 | 完成判据 |
| --- | --- | --- |
| 1 | 产品文档、领域词汇、架构、覆盖矩阵与 issues | 逐份审计、过时状态清理、链接有效，保留未验收边界 |
| 2 | 工作台行为规格与失败测试 | 用户意图、失败恢复和数据不变条件可追溯 |
| 3 | 多栏导航/概览/文献/版本及布局实现 | 用户动作可到达真实功能，状态与文稿归属一致 |
| 4 | 自动验证 | 相关测试、类型、lint/build及必要回归真实通过 |
| 5 | ComputerUse | 实际窗口中完成写作/资料/版本/布局流程，保存截图、结果与限制 |
| 6 | 文档/issues 收尾 | 只把实际达到判据的任务标记完成，列明未验证项 |

进程盘点、硬超时、串行重任务与回收沿用现有 acceptance runner。用户原测试工作树保留，当前实现位于 InkStream-workbench-v2。开发验收之后，用户已追加授权合并 main 并发布 2.1.0；合并与资产就绪见 [PR 49](https://github.com/KRPCT/InkStream/pull/49)、[发行页](https://github.com/KRPCT/InkStream/releases/tag/v2.1.0)。
