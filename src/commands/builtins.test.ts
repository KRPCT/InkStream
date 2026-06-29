import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { windowControls } from '../ipc/window';
import { useAboutStore } from '../stores/useAboutStore';
import { usePaletteStore } from '../stores/usePaletteStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { DEFAULT_LAYOUT } from '../types/workbench';
import { registerBuiltinCommands } from './builtins';
import { dispose as disposeKeymap, init as initKeymap, normalizeEvent } from './keymap';
import { hydrate } from './mru';
import { execute, getAll } from './registry';
import { toggleRenderMode } from '../editor/livepreview/renderMode';

vi.mock('../editor/livepreview/renderMode', () => ({
  toggleRenderMode: vi.fn(() => null),
}));

const requestOpenFolder = vi.fn(() => Promise.resolve());
const requestOpenFile = vi.fn(() => Promise.resolve());
vi.mock('../editor/vaultFlow', () => ({
  requestOpenFolder: () => requestOpenFolder(),
  requestOpenFile: () => requestOpenFile(),
  requestOpenRecent: vi.fn(() => Promise.resolve()),
  switchVault: vi.fn(() => Promise.resolve()),
  parentDir: vi.fn(),
  relativeWithinVault: vi.fn(),
}));

const newDraftDocument = vi.fn();
vi.mock('../editor/draftFlow', () => ({
  newDraftDocument: () => newDraftDocument(),
  saveDraftAs: vi.fn(() => Promise.resolve()),
}));

/** UI-SPEC / R4 命令注册表文案表字面（含 TitleBar 菜单条目的命令面板/退出）。 */
const TITLES: Record<string, string> = {
  'theme.light': '主题：亮色',
  'theme.dark': '主题：暗色',
  'theme.system': '主题：跟随系统',
  'view.toggle-sidebar': '视图：切换侧边栏',
  'view.toggle-right-panel': '视图：切换右侧面板',
  'view.reset-layout': '视图：重置当前模式布局',
  'view.open-graph': '视图：知识图谱',
  'view.project-search': '视图：全库搜索替换',
  'view.toggle-terminal': '视图：内置终端',
  'view.command-palette': '视图：命令面板',
  'view.settings': '视图：设置',
  'file.open-file': '文件：打开文件',
  'file.open-folder': '文件：打开文件夹',
  'file.open-recent': '文件：打开最近',
  'file.new-document': '文件：新建文档',
  'file.new-file': '文件：新建文件',
  'file.new-folder': '文件：新建文件夹',
  'file.save': '文件：保存',
  'file.rename': '文件：在文件树中重命名',
  'file.delete': '文件：删除到回收站',
  'view.collapse-tree': '视图：折叠文件树',
  'go.quick-open': '转到：快速打开文件',
  'doc.toggle-language': '文档：切换文档语言',
  'view.toggle-render-mode': '视图：切换渲染模式',
  'view.zoom-in': '视图：放大界面',
  'view.zoom-out': '视图：缩小界面',
  'view.zoom-reset': '视图：重置界面缩放',
  'view.toggle-typewriter': '视图：打字机模式',
  'view.toggle-focus': '视图：专注模式',
  'writing.toggle-hud': '写作：写作 HUD（码字速度 / 时间 / 番茄钟）',
  'view.open-reading': '视图：阅读模式',
  'file.export-html': '文件：导出为 HTML',
  'file.export-pdf': '文件：导出为 PDF',
  'file.export-docx': '文件：导出为 DOCX',
  'file.export-odt': '文件：导出为 ODT（pandoc）',
  'file.export-rtf': '文件：导出为 RTF（pandoc）',
  'file.export-latex': '文件：导出为 LaTeX（pandoc）',
  'file.export-epub': '文件：导出为 EPUB（pandoc）',
  'file.export-typst': '文件：导出为 Typst（pandoc）',
  'file.export-org': '文件：导出为 Org（pandoc）',
  'app.exit': '应用：退出',
  'mode.switch-standard': '模式：切换到 Standard（通用）',
  'mode.switch-academic': '模式：切换到 Academic（学术）',
  'mode.switch-creative': '模式：切换到 Creative（长篇创作）',
  'app.about': '帮助：关于 InkStream',
  'help.guide': '帮助：使用教程',
  'help.onboarding': '帮助：重新引导',
  'help.shortcuts': '帮助：快捷键参考',
  'help.check-update': '帮助：检查更新',
  'help.whats-new': '帮助：更新公告',
  // 编辑组
  'edit.undo': '编辑：撤销',
  'edit.redo': '编辑：重做',
  'edit.cut': '编辑：剪切',
  'edit.copy': '编辑：复制',
  'edit.paste': '编辑：粘贴',
  'edit.select-all': '编辑：全选',
  'edit.find': '编辑：查找',
  'edit.replace': '编辑：替换',
  // 段落组
  'para.heading-1': '段落：标题 1',
  'para.paragraph': '段落：正文',
  'para.ul': '段落：无序列表',
  'para.ol': '段落：有序列表',
  'para.task': '段落：任务列表',
  'para.quote': '段落：引用',
  'para.table': '段落：表格',
  'para.code-fence': '段落：代码块',
  'para.math-block': '段落：数学块',
  // 格式组
  'fmt.bold': '格式：加粗',
  'fmt.italic': '格式：斜体',
  'fmt.code': '格式：行内代码',
  'fmt.strike': '格式：删除线',
  'fmt.highlight': '格式：高亮',
  'fmt.link': '格式：插入链接',
  'fmt.image': '格式：插入图片',
  'fmt.clear': '格式：清除格式',
  // 学术组（Phase 8）
  'academic.cite': '学术：插入引用（Zotero）',
  'academic.footnote': '学术：插入脚注',
  'academic.bibliography': '学术：插入参考文献',
  'academic.biblio-gbt7714': '学术：参考文献（GB/T 7714）',
  'academic.biblio-apa': '学术：参考文献（APA）',
  'academic.biblio-vancouver': '学术：参考文献（Vancouver）',
  // 书架（FEAT-SHELF ×4）
  'bookshelf.open': '书架：打开书架',
  'bookshelf.add-current': '书架：把当前阅读文档加入书架',
  'bookshelf.import-files': '书架：导入书籍文件',
  'bookshelf.import-folder': '书架：导入书籍文件夹',
};

/** 生产命令总数：…前略… + pandoc 格式导出(×6) + 检查更新(×1) + 更新公告(×1) + 书架(open/add/import-files/import-folder ×4) + 内置终端(×1, #3) + 界面缩放(zoom-in/out/reset ×3, v1.2.1) = 91。 */
const COMMAND_COUNT = 91;

/** 生产命令（剔除 dev.* DEV-only 命令，如 IME 探针 dev.ime-probe）。 */
function prodCommands() {
  return getAll().filter((c) => !c.id.startsWith('dev.'));
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, ...init });
}

let disposeBuiltins: () => void;

describe('builtins', () => {
  beforeEach(() => {
    hydrate([]);
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    usePaletteStore.setState(usePaletteStore.getInitialState(), true);
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.mode;
    requestOpenFolder.mockClear();
    requestOpenFile.mockClear();
    disposeBuiltins = registerBuiltinCommands();
  });

  afterEach(() => {
    disposeBuiltins();
    disposeKeymap();
  });

  it('注册全部生产命令，标题与 UI-SPEC / R4 字面逐字一致', () => {
    const all = prodCommands();
    expect(all).toHaveLength(COMMAND_COUNT);
    for (const [id, title] of Object.entries(TITLES)) {
      expect(all.find((c) => c.id === id)?.title).toBe(title);
    }
  });

  it('DEV 下 registerBuiltinCommands 一并注册 IME 探针命令（dev.ime-probe）', () => {
    expect(import.meta.env.DEV).toBe(true);
    expect(getAll().some((c) => c.id === 'dev.ime-probe')).toBe(true);
    // 探针属 DEV-only，不计入生产命令总数。
    expect(prodCommands().some((c) => c.id === 'dev.ime-probe')).toBe(false);
  });

  it('快捷键提示与键盘表一致（R4 §3 键位裁决）', () => {
    const byId = new Map(getAll().map((c) => [c.id, c]));
    // 侧栏让位 Ctrl+B（加粗），改 Ctrl+\
    expect(byId.get('view.toggle-sidebar')?.shortcut).toBe('Ctrl+\\');
    expect(byId.get('view.toggle-right-panel')?.shortcut).toBe('Ctrl+Alt+B');
    expect(byId.get('view.command-palette')?.shortcut).toBe('Ctrl+Shift+P');
    expect(byId.get('go.quick-open')?.shortcut).toBe('Ctrl+P');
    // Ctrl+O 给打开文件；打开文件夹让位 Ctrl+Shift+O
    expect(byId.get('file.open-file')?.shortcut).toBe('Ctrl+O');
    expect(byId.get('file.open-folder')?.shortcut).toBe('Ctrl+Shift+O');
    // Ctrl+N 归「新建文档」（草稿）；树内建文件让位 Ctrl+Alt+N
    expect(byId.get('file.new-document')?.shortcut).toBe('Ctrl+N');
    expect(byId.get('file.new-file')?.shortcut).toBe('Ctrl+Alt+N');
    // 加粗占用 Ctrl+B；渲染模式保留 Ctrl+E
    expect(byId.get('fmt.bold')?.shortcut).toBe('Ctrl+B');
    expect(byId.get('view.toggle-render-mode')?.shortcut).toBe('Ctrl+E');
  });

  it('合成 Ctrl+O 经 keymap 归一映射并触发打开文件（R4 §3）', () => {
    initKeymap();
    expect(normalizeEvent(key({ key: 'o', ctrlKey: true }))).toBe('Ctrl+O');
    window.dispatchEvent(key({ key: 'o', ctrlKey: true }));
    expect(requestOpenFile).toHaveBeenCalledTimes(1);
    expect(requestOpenFolder).not.toHaveBeenCalled();
  });

  it('合成 Ctrl+Shift+O 触发打开文件夹', () => {
    initKeymap();
    window.dispatchEvent(key({ key: 'O', ctrlKey: true, shiftKey: true }));
    expect(requestOpenFolder).toHaveBeenCalledTimes(1);
  });

  it('合成 Ctrl+N 触发新建草稿文档（无 vault 也可用）', () => {
    initKeymap();
    window.dispatchEvent(key({ key: 'n', ctrlKey: true }));
    expect(newDraftDocument).toHaveBeenCalledTimes(1);
  });

  it('重复调用安全（StrictMode）：先清旧注册再登记', () => {
    expect(() => {
      disposeBuiltins = registerBuiltinCommands();
    }).not.toThrow();
    expect(prodCommands()).toHaveLength(COMMAND_COUNT);
  });

  it('合成 Ctrl+P 经 keymap 打开无前缀快速打开', () => {
    initKeymap();
    window.dispatchEvent(key({ key: 'p', ctrlKey: true }));
    expect(usePaletteStore.getState().open).toBe(true);
    expect(usePaletteStore.getState().query).toBe('');
  });

  it('execute mode.switch-academic 切换模式且不占用全局快捷键（D-08）', async () => {
    await execute('mode.switch-academic');
    expect(useWorkbenchStore.getState().mode).toBe('academic');
    expect(document.documentElement.dataset.mode).toBe('academic');
    const byId = new Map(getAll().map((c) => [c.id, c]));
    expect(byId.get('mode.switch-academic')?.title).toBe('模式：切换到 Academic（学术）');
    expect(byId.get('mode.switch-standard')?.shortcut).toBeUndefined();
    expect(byId.get('mode.switch-academic')?.shortcut).toBeUndefined();
    expect(byId.get('mode.switch-creative')?.shortcut).toBeUndefined();
  });

  it('execute theme.dark 后 documentElement data-theme=dark', async () => {
    await execute('theme.dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('execute view.toggle-sidebar 翻转当前模式 sidebarCollapsed', async () => {
    await execute('view.toggle-sidebar');
    expect(useWorkbenchStore.getState().layouts.standard.sidebarCollapsed).toBe(true);
    await execute('view.toggle-sidebar');
    expect(useWorkbenchStore.getState().layouts.standard.sidebarCollapsed).toBe(false);
  });

  it('合成 Ctrl+\\ 切侧栏、Ctrl+Alt+B 切右栏（R4 §3 侧栏让位 Ctrl+B）', () => {
    initKeymap();
    window.dispatchEvent(key({ key: '\\', ctrlKey: true }));
    expect(useWorkbenchStore.getState().layouts.standard.sidebarCollapsed).toBe(true);
    window.dispatchEvent(key({ key: 'b', ctrlKey: true, altKey: true }));
    expect(useWorkbenchStore.getState().layouts.standard.rightPanelCollapsed).toBe(true);
  });

  it('Ctrl+B 不再 window 级绑定（交 CM markdownEditKeymap 处理加粗），侧栏不动', () => {
    initKeymap();
    const before = useWorkbenchStore.getState().layouts.standard.sidebarCollapsed;
    window.dispatchEvent(key({ key: 'b', ctrlKey: true }));
    expect(useWorkbenchStore.getState().layouts.standard.sidebarCollapsed).toBe(before);
  });

  it('合成 Ctrl+Shift+P 切换命令面板', () => {
    initKeymap();
    window.dispatchEvent(key({ key: 'P', ctrlKey: true, shiftKey: true }));
    expect(usePaletteStore.getState().open).toBe(true);
    expect(usePaletteStore.getState().query).toBe('>');
    window.dispatchEvent(key({ key: 'P', ctrlKey: true, shiftKey: true }));
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it('execute view.reset-layout 恢复 DEFAULT_LAYOUT', async () => {
    useWorkbenchStore.getState().setLayout({ sidebarWidth: 333, rightPanelCollapsed: true });
    await execute('view.reset-layout');
    expect(useWorkbenchStore.getState().layouts.standard).toEqual(DEFAULT_LAYOUT);
  });

  it('execute app.about 打开关于对话框状态', async () => {
    useAboutStore.setState(useAboutStore.getInitialState(), true);
    await execute('app.about');
    expect(useAboutStore.getState().open).toBe(true);
  });

  it('view.toggle-render-mode 注册：title/shortcut 与 UI-SPEC 一致', () => {
    const byId = new Map(getAll().map((c) => [c.id, c]));
    const cmd = byId.get('view.toggle-render-mode');
    expect(cmd?.title).toBe('视图：切换渲染模式');
    expect(cmd?.shortcut).toBe('Ctrl+E');
  });

  it('execute view.toggle-render-mode 调 toggleRenderMode', async () => {
    vi.mocked(toggleRenderMode).mockClear();
    await execute('view.toggle-render-mode');
    expect(toggleRenderMode).toHaveBeenCalledTimes(1);
  });

  it('合成 Ctrl+E 经 keymap 归一映射并触发渲染模式切换', () => {
    initKeymap();
    vi.mocked(toggleRenderMode).mockClear();
    expect(normalizeEvent(key({ key: 'e', ctrlKey: true }))).toBe('Ctrl+E');
    window.dispatchEvent(key({ key: 'e', ctrlKey: true }));
    expect(toggleRenderMode).toHaveBeenCalledTimes(1);
  });

  it('合成 Ctrl+G 打开知识图谱中央视图（LINK-06），再按回编辑器', () => {
    initKeymap();
    expect(normalizeEvent(key({ key: 'g', ctrlKey: true }))).toBe('Ctrl+G');
    window.dispatchEvent(key({ key: 'g', ctrlKey: true }));
    expect(useWorkbenchStore.getState().centralView).toBe('graph');
    window.dispatchEvent(key({ key: 'g', ctrlKey: true }));
    expect(useWorkbenchStore.getState().centralView).toBe('editor');
  });

  it('Ctrl+` 仅在内置终端启用时切换 dock（未启用时不动）', () => {
    initKeymap();
    expect(normalizeEvent(key({ key: '`', ctrlKey: true }))).toBe('Ctrl+`');
    // 默认未启用：不切换。
    window.dispatchEvent(key({ key: '`', ctrlKey: true }));
    expect(useWorkbenchStore.getState().terminalOpen).toBe(false);
    // 设置启用后：切换 terminalOpen。
    useSettingsStore.setState({ terminalEnabled: true });
    window.dispatchEvent(key({ key: '`', ctrlKey: true }));
    expect(useWorkbenchStore.getState().terminalOpen).toBe(true);
  });

  it('合成 Ctrl+= / Ctrl+- / Ctrl+0 调整界面缩放（v1.2.1）', () => {
    initKeymap();
    expect(normalizeEvent(key({ key: '=', ctrlKey: true }))).toBe('Ctrl+=');
    window.dispatchEvent(key({ key: '=', ctrlKey: true }));
    expect(useSettingsStore.getState().uiZoom).toBeCloseTo(1.1);
    window.dispatchEvent(key({ key: '-', ctrlKey: true }));
    expect(useSettingsStore.getState().uiZoom).toBeCloseTo(1);
    // 先放大再按 Ctrl+0 重置回 1。
    window.dispatchEvent(key({ key: '=', ctrlKey: true }));
    window.dispatchEvent(key({ key: '0', ctrlKey: true }));
    expect(useSettingsStore.getState().uiZoom).toBe(1);
  });

  it('execute app.exit 经 ipc 收口调 close', async () => {
    const close = vi.spyOn(windowControls, 'close').mockResolvedValue(undefined);
    await execute('app.exit');
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
  });
});
