# 旧 v1 功能修复的行为规格；部分检查经人工映射接入 pnpm test:acceptance，详见 AUTOMATION.md。
# .feature 不由 runner 解释；关联检查通过不代表全部步骤已绑定或通过。
# 不包含新项目实体、跨重启会话恢复或 UI 材质实现。
@specification @partially_bound @manual_vitest_mapping @document_session
Feature: 文档身份与保存结果保持一致
  作为在多个文档间写作的用户
  我需要标签、正文与保存位置始终对应同一文档
  并在保存失败或出现外部冲突时保留未保存内容

  @issue_2
  Scenario: 关闭活动 A 后继续编辑的是 B
    Given 已打开的 "A.md" 正文是 "甲文原稿"
    And 已打开的 "B.md" 正文是 "乙文原稿"
    And 我正在编辑 "A.md"
    When 我关闭 "A.md"
    Then 活动标签应为 "B.md" 且正文应为 "乙文原稿"
    When 我在正文末尾输入 "补充" 并保存
    Then 磁盘上的 "B.md" 应为 "乙文原稿补充"
    And 磁盘上的 "A.md" 应保持 "甲文原稿"

  @issue_3
  Scenario Outline: 未成功保存时关闭请求保留正文
    Given "A.md" 有未保存正文 "必须保留的修改"
    And "A.md" 的保存状态为 "<状态>"
    When 我请求关闭 "A.md" 且没有确认丢弃修改
    Then "A.md" 的标签和 "必须保留的修改" 应仍然可访问
    And "A.md" 应仍显示未保存状态
    And 应显示 "<反馈>"
    Examples:
      | 状态             | 反馈                       |
      | 磁盘拒绝写入     | 保存失败                   |
      | 外部冲突尚未解决 | 需要先解决冲突或选择保留方式 |

  @issue_3
  Scenario: 保留我的内容写入失败后仍可继续裁决冲突
    Given "A.md" 存在未保存修改与外部修改冲突
    When 我选择保留我的内容并确认覆盖磁盘
    And 本次磁盘写入失败
    Then 冲突提示和未保存正文应保留
    And 未再次成功完成裁决前不得自动覆盖外部内容

  @issue_3
  Scenario: v1 保存期间产生的 v2 仍需保存
    Given 我关闭了自动保存并将 "A.md" 改为 "v1"
    When 我保存 "v1" 且磁盘写入尚未完成
    And 我继续把正文改为 "v2"
    And "v1" 的磁盘写入完成
    Then 编辑器正文应为 "v2" 且仍显示未保存
    And 我退出应用时应收到未保存内容提示
    When 我再次保存且写入成功
    Then 磁盘正文应为 "v2" 且未保存标记才可消失

  @issue_4
  Scenario: 干净后台文档外部更新后显示新版本
    Given 后台标签 "A.md" 与磁盘正文均为 "旧版"
    And 我正在编辑另一个文档
    When 其他程序将 "A.md" 改为 "新版"
    And 我切回 "A.md"
    Then 正文应为 "新版"
    When 我不作编辑便保存或关闭 "A.md"
    Then 磁盘正文仍应为 "新版"

  @issue_4
  Scenario: 后台文档有未保存修改时外部更新不得静默覆盖
    Given 后台标签 "A.md" 有未保存正文 "我的修改"
    When 其他程序将 "A.md" 改为 "外部修改"
    And 我切回 "A.md"
    Then "我的修改" 应保留并显示外部冲突提示
    And 裁决前磁盘应保持 "外部修改"

  @issue_5
  Scenario Outline: 文件改名或移动后继续保存到新的位置
    Given 我打开了 "初稿/A.md" 并有未保存正文 "修订稿"
    When 我通过文件树将 "初稿/A.md" <操作>
    Then 标签应显示 "<目标>" 对应的文档
    And 正文 "修订稿" 及其撤销历史应保留
    When 我保存该文档
    Then "<目标>" 的磁盘正文应为 "修订稿"
    And "初稿/A.md" 不得因保存而重新出现
    Examples:
      | 操作                     | 目标      |
      | 重命名为 B.md            | 初稿/B.md |
      | 移动到 定稿 文件夹       | 定稿/A.md |
      | 随父目录初稿移动到归档下 | 归档/初稿/A.md |

  @issue_5
  Scenario: 删除已保存文档后自动保存不复活旧路径
    Given "A.md" 已打开且全部修改已保存
    When 我在文件树确认将 "A.md" 移到回收站
    Then 工作区文件树不应再列出 "A.md"
    And 后续自动保存不得重新创建该文件
    And 编辑区不得将已删除路径显示为可正常保存的文档

  @issue_23
  Scenario: 选择同名链接候选后保留所选文件身份
    Given 工作区有 "研究/方法.md" 和 "随笔/方法.md"
    When 我在双向链接补全中选择 "研究/方法.md"
    And 我点击生成的链接
    Then 应打开 "研究/方法.md" 的正文

  @issue_23
  Scenario Outline: 双向链接定位到标题或文本块
    Given "方法.md" 含标题 "实验设计" 和标识为 "p3" 的文本块
    When 我点击 "<链接>"
    Then 应打开 "方法.md" 并将 "<位置>" 显示在可见区域
    Examples:
      | 链接                 | 位置                |
      | [[方法#实验设计]]    | 标题实验设计        |
      | [[方法^p3]]          | 标识为 p3 的文本块  |
