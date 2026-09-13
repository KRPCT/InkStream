// Named user-behavior checks for the workbench. Gherkin remains a reviewed specification.
export const workbenchGroups = [
  { file: 'src/components/workbench/RightPanel.test.tsx', tests: [
    ['wb-simple-return', 'WB-06 从简易模式返回创作后，选中可用工具并显示内容'],
  ] },
  { file: 'src/components/workbench/Workspace.integration.test.tsx', tests: [
    ['wb-overview', 'WB-01 概览往返不卸载真实编辑器，保留修改、选区、撤销；概览数据来自会话'],
    ['wb-file-navigation', 'WB-01 从概览使用文件导航会显示所开文稿，复用同一编辑器'],
    ['wb-insert', 'WB-03 文献工作区先查看，再明确插入到原文稿选区；撤销可恢复正文'],
  ] },
  { file: 'src/components/projects/ProjectRail.test.tsx', tests: [
    ['wb-project-switch', 'WB-02 项目轨使用完整切换入口，失败保持当前项目并展示档案中的错误'],
    ['wb-pane-feedback', 'WB-07 两栏开关独立，选中反馈跟随实际折叠状态'],
  ] },
  { file: 'src/projects/session.test.ts', tests: [
    ['wb-save-failure', '文件保存失败保留当前完整正文、dirty与所有者，未触碰目标/索引/监听'],
  ] },
  { file: 'src/academic/useReferenceLibrary.test.tsx', tests: [
    ['wb-library-detail', 'WB-04 切换库立即清空旧选择，迟到详情不能进入新库或成为插入目标'],
    ['wb-library-list', 'WB-04 迟到列表不能覆盖当前库，卸载释放订阅'],
  ] },
  { file: 'src/components/workbench/PanelTabs.test.tsx', tests: [
    ['wb-tool-keys', 'WB-05：Tab 只进入活动工具，方向键切换后 Tab 离开标签栏'],
    ['wb-tool-content', 'WB-05：键盘切换同时显示对应工具内容，隐藏原内容并保留已挂载面板'],
  ] },
  { file: 'src/components/workbench/EditorTabs.test.tsx', tests: [
    ['wb-document-keys', 'WB-05：Tab 只进入活动文档及其可见关闭按钮，然后离开文档栏'],
    ['wb-close-guard', 'WB-05：键盘关闭脏草稿仍可取消丢弃，且不调用落盘'],
  ] },
  { file: 'src/components/workbench/WorkspaceNavigation.test.tsx', tests: [
    ['wb-simple-references', 'WB-06 简易模式使文献目的地退回原文稿并隐藏高级入口'],
    ['wb-simple-versions', 'WB-06 简易模式使版本目的地退回原文稿并隐藏高级入口'],
  ] },
  { file: 'src/components/workbench/ProjectVersions.test.tsx', tests: [
    ['wb-versions-empty', 'WB-08 版本空态保留两侧导航及编辑器，返回文稿仍是原视图'],
    ['wb-versions-owner', 'WB-08 版本列表只展示当前仓库的数据，切换后不显示旧项目的提交'],
  ] },
];
const file = 'docs/specs/workbench-ux.feature';
export const workbenchScenarios = [
  ['WB-01', '在概览与文稿之间往返保留写作状态', ['wb-overview', 'wb-file-navigation']],
  ['WB-02', '项目轨的快捷切换遵循保存结果', ['wb-project-switch', 'wb-save-failure']],
  ['WB-03', '文献选择与插入分离', ['wb-insert']],
  ['WB-04', '文献库变化拒绝过期选择', ['wb-library-detail', 'wb-library-list']],
  ['WB-05', '工具与文档标签可用键盘切换', ['wb-tool-keys', 'wb-tool-content', 'wb-document-keys', 'wb-close-guard']],
  ['WB-06', '简易模式使高级目的地回到文稿', ['wb-simple-references', 'wb-simple-versions', 'wb-simple-return']],
  ['WB-07', '面板和缩放保留用户布局', ['wb-pane-feedback']],
  ['WB-08', '版本视图保留项目导航', ['wb-versions-empty', 'wb-versions-owner']],
].map(([id, name, checks]) => ({ id, name: `${id} ${name}`, file, checks, status: 'partial',
  gap: '自动检查范围见对应测试。真实窗口、缩放及本轮 ComputerUse 观察另见 docs/WORKBENCH-ACCEPTANCE.md；不代表真实 Zotero 账户或物理 IME 验收。' }));
