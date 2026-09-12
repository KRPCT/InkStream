import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppVersion } from '../../ipc/app';
import { pickExportPath } from '../../ipc/dialog';
import { readImageBytes, writeBytesToPath, writeFileToPath } from '../../ipc/files';
import { pandocConvert } from '../../ipc/pandoc';
import { useEditorStore } from '../../stores/useEditorStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { setView } from '../viewHandle';
import { printHtml } from './exportPdf';
import { exportDocument, exportViaPandoc } from './runExport';

vi.mock('../../ipc/app', () => ({ getAppVersion: vi.fn() }));
vi.mock('../../ipc/dialog', async (original) => ({ ...await original<typeof import('../../ipc/dialog')>(), pickExportPath: vi.fn() }));
vi.mock('../../ipc/files', async (original) => ({
  ...await original<typeof import('../../ipc/files')>(), readImageBytes: vi.fn(), writeFileToPath: vi.fn(), writeBytesToPath: vi.fn(),
}));
vi.mock('../../ipc/pandoc', () => ({ pandocConvert: vi.fn() }));
vi.mock('../livepreview/mathLoader', () => ({ loadKatex: vi.fn().mockRejectedValue(new Error('Use plain math fallback in export fixture')) }));
vi.mock('./exportPdf', () => ({ printHtml: vi.fn() }));

const original = '# First document\n\n![Original image](figure.png)';
let view: EditorView;
beforeEach(() => {
  vi.clearAllMocks();
  useWorkbenchStore.setState({ centralView: 'editor' });
  useSettingsStore.setState({ exportBrandingFooter: false, exportBrandingText: 'Original watermark' });
  useVaultStore.setState({ vault: { root: 'C:/first-vault', name: 'first', repoRoot: null } });
  useEditorStore.setState({ ...useEditorStore.getInitialState(), activePath: 'notes/first.md', tabs: [{ path: 'notes/first.md', name: 'first.md' }] }, true);
  view = new EditorView({ state: EditorState.create({ doc: original }) });
  setView(view);
  vi.mocked(getAppVersion).mockResolvedValue('1.0.0');
  vi.mocked(pickExportPath).mockResolvedValue('C:/exports/result.html');
  vi.mocked(readImageBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));
  vi.mocked(writeFileToPath).mockResolvedValue(null);
  vi.mocked(writeBytesToPath).mockResolvedValue(null);
  vi.mocked(pandocConvert).mockResolvedValue(null);
});
afterEach(() => { setView(null); view.destroy(); useWorkbenchStore.setState({ centralView: 'editor' }); });

function switchWorkspace(): void {
  useVaultStore.setState({ vault: { root: 'C:/second-vault', name: 'second', repoRoot: null } });
  useEditorStore.setState({ activePath: 'second.md', tabs: [{ path: 'second.md', name: 'second.md' }] });
  view.setState(EditorState.create({ doc: '# Second document' }));
}

describe('document exports capture a single source before asynchronous work', () => {
  it('HTML preserves the original text and original image directory when the workspace switches while loading', async () => {
    let resolveVersion!: (version: string) => void;
    vi.mocked(getAppVersion).mockReturnValueOnce(new Promise((resolve) => { resolveVersion = resolve; }));
    const pending = exportDocument('html');
    switchWorkspace();
    resolveVersion('1.0.0');
    await pending;
    expect(readImageBytes).toHaveBeenCalledWith('C:/first-vault/notes/figure.png');
    expect(pickExportPath).toHaveBeenCalledWith('first.html', 'html');
    expect(writeFileToPath).toHaveBeenCalledTimes(1);
    const html = vi.mocked(writeFileToPath).mock.calls[0][1];
    expect(html).toContain('First document');
    expect(html).toContain('data:image/png;base64,AQID');
    expect(html).not.toContain('Second document');
  });

  it('Pandoc keeps the original text, watermark and resource path while the save dialog is pending', async () => {
    useSettingsStore.setState({ exportBrandingFooter: true });
    let resolvePath!: (path: string) => void;
    vi.mocked(pickExportPath).mockReturnValueOnce(new Promise((resolve) => { resolvePath = resolve; }));
    const pending = exportViaPandoc('odt');
    switchWorkspace();
    useSettingsStore.setState({ exportBrandingText: 'New watermark' });
    resolvePath('C:/exports/first.odt');
    await pending;
    expect(pandocConvert).toHaveBeenCalledTimes(1);
    const [markdown, output, format, resources] = vi.mocked(pandocConvert).mock.calls[0];
    expect(markdown).toContain(original);
    expect(markdown).toContain('Original watermark');
    expect(markdown).not.toContain('Second document');
    expect(markdown).not.toContain('New watermark');
    expect([output, format, resources]).toEqual(['C:/exports/first.odt', 'odt', 'C:/first-vault/notes']);
  });

  it('comparison does not export the hidden main document through any export entry', async () => {
    useWorkbenchStore.setState({ centralView: 'gitGraph' });
    await exportDocument('html'); await exportDocument('pdf'); await exportDocument('docx'); await exportViaPandoc('odt');
    expect(pickExportPath).not.toHaveBeenCalled();
    expect(writeFileToPath).not.toHaveBeenCalled();
    expect(writeBytesToPath).not.toHaveBeenCalled();
    expect(printHtml).not.toHaveBeenCalled();
    expect(pandocConvert).not.toHaveBeenCalled();
    expect(getAppVersion).not.toHaveBeenCalled();
  });
});
