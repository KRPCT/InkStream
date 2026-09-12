// Human-reviewed links to named Vitest checks. This file does not parse or execute Gherkin.
export const groups = [
  { file: 'src/test/document-session.integration.test.tsx', tests: [
    ['doc-close', 'FE-01: closing active A must activate B content before B can be saved'],
    ['doc-failed-save', 'FE-02: a failed close-save must preserve the dirty background A buffer and tab'],
    ['doc-conflict', 'a failed explicit conflict overwrite keeps the conflict and the unsaved buffer'],
    ['doc-revision', 'a successful older write leaves edits made while saving dirty'],
    ['doc-external', 'a clean background document reloads external content before activation and saving'],
    ['doc-save-as', 'Save As retains edits made while the chosen file is being written'],
  ] },
  { file: 'src/editor/workspaceSession.integration.test.ts', tests: [
    ['workspace-missing', 'an inaccessible target leaves the original workspace and its watcher operational'],
    ['workspace-order', 'prepares the complete target before publishing, and later requests finish consistently'],
    ['workspace-watch', 'does not publish a target whose watcher cannot start'],
  ] },
  { file: 'src/editor/documentFileMutations.test.ts', tests: [
    ['file-rename', '重命名后活动身份、显示名、缓存和未保存正文一致，后续只写新路径'],
    ['file-delete-dirty', '删除打开的脏文档后保留最新正文为明确标记的草稿，旧路径不被保存复活'],
    ['file-parent-move', '父目录移动及撤销迁移全部子文档，前缀相似的其它目录不受影响'],
    ['file-drain', '先排空旧路径的在途保存，再迁移等待期间继续编辑的最新正文'],
    ['file-failure', '磁盘重命名失败保留身份和缓冲，并恢复后续保存与真实外部事件'],
    ['file-stale', '等待其它文档transition期间切库后，旧文件树操作不会改到新工作区'],
  ] },
  { file: 'src/editor/livepreview/wikiNavigation.test.ts', tests: [
    ['wiki-heading', '打开确定路径后定位正文标题，不命中代码围栏中的同名示例'],
    ['wiki-block', '块链接把光标放到所引段落开头，Unicode 块标识可定位'],
    ['wiki-self', '当前文档的标题链接直接定位，保留原文并兼容 Unicode 规范等价'],
    ['wiki-missing-anchor', '标题不存在时明确提示，不把打开文件误报为精确定位成功'],
    ['wiki-dirty-target', '目标已经打开时基于未保存正文定位，不用磁盘旧版覆盖编辑缓冲'],
    ['wiki-ambiguous', '裸名有歧义时不打开第一个文件，也不当作缺失文件创建'],
    ['wiki-cancel', '不存在的文件先提示创建，取消不写文件也不离开原文档'],
    ['wiki-create', '确认创建后才写入并打开新文件，来源文档保持原文'],
  ] },
  { file: 'src/editor/livepreview/wikiLinkComplete.test.ts', tests: [
    ['wiki-completion', '同名候选按所选目录插入链接，不丢失文件身份'],
  ] },
];

const document = 'docs/specs/document-session.feature';
const workspace = 'docs/specs/workspace-session.feature';
// A passed related check never changes partial/pending into complete. Gaps require additional evidence.
export const scenarios = [
  { id: 'DOC-01', file: document, name: '关闭活动 A 后继续编辑的是 B', status: 'partial', checks: ['doc-close'], gap: '补充输入后的 B 保存、A 磁盘不变及真实文件往返仍需对应证据。' },
  { id: 'DOC-02', file: document, name: '未成功保存时关闭请求保留正文', status: 'partial', checks: ['doc-failed-save'], gap: '仅磁盘失败回归；外部冲突 Examples 行、明确反馈断言仍待绑定。' },
  { id: 'DOC-03', file: document, name: '保留我的内容写入失败后仍可继续裁决冲突', status: 'partial', checks: ['doc-conflict'], gap: '绑定冲突提示/冻结/正文；再次裁决和自动保存不得越权的完整流程待绑定。' },
  { id: 'DOC-04', file: document, name: 'v1 保存期间产生的 v2 仍需保存', status: 'partial', checks: ['doc-revision'], gap: '绑定修订与再次保存；退出应用提示和真实磁盘故障证据待补。' },
  { id: 'DOC-05', file: document, name: '干净后台文档外部更新后显示新版本', status: 'partial', checks: ['doc-external'], gap: '事件与文件 I/O 是受控边界；真实 watcher 到磁盘往返待验证。' },
  { id: 'DOC-06', file: document, name: '后台文档有未保存修改时外部更新不得静默覆盖', status: 'pending', checks: [], gap: '尚未绑定完整后台脏文档→外部更新→切回→冲突裁决场景。' },
  { id: 'DOC-07', file: document, name: '文件改名或移动后继续保存到新的位置', status: 'partial', checks: ['file-rename', 'file-parent-move', 'file-drain'], gap: '独立文件移动 Examples 行、编辑撤销历史与各行最终落盘需逐项补证。' },
  { id: 'DOC-08', file: document, name: '删除已保存文档后自动保存不复活旧路径', status: 'pending', checks: [], gap: 'file-delete-dirty 是补充脏文档回归，不替代本场景“全部已保存”的前置与文件树断言。' },
  { id: 'DOC-09', file: document, name: '选择同名链接候选后保留所选文件身份', status: 'partial', checks: ['wiki-completion', 'wiki-heading'], gap: '补全与导航分别验证；尚未把实际补全产物串入同一次点击场景。' },
  { id: 'DOC-10', file: document, name: '双向链接定位到标题或文本块', status: 'partial', checks: ['wiki-heading', 'wiki-block', 'wiki-self'], gap: '绑定文档与偏移；原生可见区域、裸 ^block 的实际手势示例仍待对应证据。' },
  { id: 'WS-01', file: workspace, name: '连续选择工作区后迟到结果不得覆盖最终选择', status: 'partial', checks: ['workspace-order', 'file-stale'], gap: '工作区/文件快照顺序已绑定；旧 A 文档保存与迟到搜索结果完整组合尚待绑定。' },
  { id: 'WS-02', file: workspace, name: '切换失败后原工作区继续接收外部修改', status: 'partial', checks: ['workspace-missing', 'workspace-watch'], gap: 'watcher 使用记录型 adapter；真实外部修改抵达原编辑缓冲仍待绑定。' },
  { id: 'WS-03', file: workspace, name: '旧工作区搜索结果不能用于新工作区替换', status: 'pending', checks: [], gap: '本命令尚未绑定搜索命中到替换文件的贯通流程。' },
  { id: 'WS-04', file: workspace, name: '经简易模式切库后索引仍按工作区隔离', status: 'pending', checks: [], gap: '本命令尚未绑定两库实际索引写入与查询回验。' },
  { id: 'WS-05', file: workspace, name: '简易模式打开新工作区不创建索引目录', status: 'pending', checks: [], gap: '需要真实文件系统确认目录未创建；不以零 IPC 调用替代。' },
  { id: 'WS-06', file: workspace, name: '禁用当前视图的能力后回到原文档', status: 'pending', checks: [], gap: '现有 setter/CentralArea 回归由完整 Vitest 执行；带原正文与继续编辑的五行 Examples 尚未绑定本命令。' },
  { id: 'WS-07', file: workspace, name: '索引提交后关系面板反映新增链接', status: 'pending', checks: [], gap: '反链和局部图谱的同一实际索引提交贯通流程尚未绑定。' },
  { id: 'WS-08', file: workspace, name: '关系查询失败不伪装成没有关系', status: 'pending', checks: [], gap: '现有面板/索引错误测试由完整 Vitest 执行，尚未审定为本命令的完整场景绑定。' },
];
