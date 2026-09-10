import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSection } from './settingsSections';

const save = vi.hoisted(() => vi.fn<(value: unknown) => Promise<void>>(async () => {}));
vi.mock('../../ipc/importedTheme', () => ({ loadCustomTheme: vi.fn(async () => null), saveCustomTheme: (value: unknown) => save(value) }));
const css = '.theme-light { --background-primary: #fff5ee; --text-normal: #231f20; } .theme-dark { --background-primary: #17191d; --text-normal: #ece7dd; }';
async function importCss(text = css) {
  const file = new File([text], 'paper-theme.css', { type: 'text/css' });
  Object.defineProperty(file, 'text', { value: async () => text });
  fireEvent.change(screen.getByLabelText('导入 Obsidian 主题'), { target: { files: [file] } });
  await screen.findByText('主题预览：paper-theme');
}

beforeEach(() => { save.mockReset().mockResolvedValue(undefined); document.getElementById('inkstream-imported-theme')?.remove(); });
afterEach(cleanup);

describe('Obsidian theme import from Appearance settings', () => {
  it('previews locally, applies only after a successful save, and can restore the built-in theme', async () => {
    render(<AppearanceSection />);
    await importCss();
    expect(document.getElementById('inkstream-imported-theme')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '应用主题' }));
    await waitFor(() => expect(document.getElementById('inkstream-imported-theme')?.textContent).toContain('#fff5ee'));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'paper-theme', css }));
    fireEvent.click(screen.getByRole('button', { name: '恢复内置主题' }));
    await waitFor(() => expect(document.getElementById('inkstream-imported-theme')).toBeNull());
    expect(save).toHaveBeenLastCalledWith(null);
  });

  it('keeps the current appearance and reviewable preview when persistence fails', async () => {
    save.mockRejectedValue(new Error('磁盘只读'));
    render(<AppearanceSection />);
    await importCss();
    fireEvent.click(screen.getByRole('button', { name: '应用主题' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘只读');
    expect(document.getElementById('inkstream-imported-theme')).toBeNull();
    expect(screen.getByText('主题预览：paper-theme')).toBeVisible();
  });

  it('cancels a preview without writing or applying the imported stylesheet', async () => {
    render(<AppearanceSection />);
    await importCss();
    fireEvent.click(screen.getByRole('button', { name: '取消预览' }));
    expect(screen.queryByText('主题预览：paper-theme')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(document.getElementById('inkstream-imported-theme')).toBeNull();
  });
});
