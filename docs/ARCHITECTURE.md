# 架构现状与工作台边界

现状：2.1.0 / main（PR 49 合并提交 `491a235`），2026-09-13。发布与验收状态统一见 [CURRENT-STATE](CURRENT-STATE.md)。

| 职责 | 实现入口 | 权威边界 |
| --- | --- | --- |
| 文档编辑 | `src/editor/documentSession.ts`、`editorState.ts`、`useCodeMirror.ts` | 主 EditorView 与文档缓存持有正文、选区、撤销；标签 store 是镜像 |
| 保存/文件身份 | `src/stores/autosave.ts`、编辑 flows、`src-tauri/src/files/` | 按身份和修订承认写入；失败保留文稿，旧结果不清新修改 |
| 项目会话 | `src/projects/session.ts`、`src-tauri/src/projects/` | 协调保存、快照、打开和恢复，每窗口一个活动项目 |
| 项目操作 | `src/projects/actions.ts`、`src/ipc/projects.ts` | UI 经既有入口添加、切换、改名、重新定位及恢复 |
| 工作台 | `useWorkbenchStore`、`effectiveCentralView`、`WorkbenchLayout` | 视图、模式、布局与能力降级，不拥有正文或保存裁决 |
| 索引/关系 | `src/ipc/index*`、`src-tauri/src/index*`、`src/graph/` | 本机可重建派生数据，查询带项目/工作区归属 |
| Git | `src-tauri/src/git/`、Git flows/stores | 仓库状态、操作与恢复，Git 根独立于内容目录 |
| 文献 | `src/academic/useReferenceLibrary.ts`、`src/ipc/zotero.ts`、引用/CSL | 库身份和游标隔离；选择条目只看资料，明确插入才改正文 |
| 创作 | Codex、章节树、场景概要、写作指标 | 用户文件为资料源，经既有文档入口编辑 |

## 编辑器与多栏

主编辑器持续挂载。切换工作区视图可隐藏它，但不重新创建正文实例；摘录/表格辅助视图不是另一份正文权威。新工作台复用现有文档、项目、Git 和引用入口。

项目浮层阻止后台编辑并保留纸面几何。常态项目轨直接切换也遵循保存/会话协议，失败需要让错误可见。导航、文档标签、模式分别表达目的地、文档身份和工具预设。

## 持久化与恢复

项目名称、封面、收藏、会话和索引已位于本机应用数据目录。内容目录保留用户文件，历史 `.inkstream` 未知内容原样保留。会话记录恢复正文、选区、滚动、模式、各模式布局及活动工具；重启不重放撤销历史。

项目协调器负责接受目标会话。布局写回只接受用户调整，拒绝启动恢复、项目切换和缩放产生的中间测量。UI 不直接改写这些协议。

## 本轮 DDD 切面

工作台统一表达概览、文稿、文献和版本，不为相同状态另建平行权威。资料选择与正文插入分离；库切换、失败和过期响应不能串库或误插入。

继续使用 React、CSS token 与 Tauri WebView。窄视口改变呈现，保存的宽度不因临时缩放被覆盖。行为规格先于实现，测试后通过 ComputerUse 操作真实窗口验收。

工作台实现由 `WorkspaceNavigation` 选择目的地，`CentralArea` 组合概览、文献、版本和保活正文。`ProjectVersions` 复用现有 Git 快照，只将复杂操作交给原全宽版本管理。资料浏览 hook 管理库修订和请求代次，插入仍经过可见可写正文命令边界，并形成独立撤销步骤。右栏始终派生可用工具，处理简易模式双向切换；收起的栏保持实例但退出焦点导航。
