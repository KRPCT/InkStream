import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVaultStore } from '../../stores/useVaultStore';
import type { FileEntry } from '../../types/vault';
import { SearchResults, SidebarSearch } from './SidebarSearch';

const openFileByPath = vi.fn();
vi.mock('../../editor/fileOpenFlow', () => ({
  openFileByPath: (path: string) => openFileByPath(path),
}));

const FILES: FileEntry[] = [
  { path: 'notes/readme.md', name: 'readme.md' },
  { path: 'docs/设计稿.md', name: '设计稿.md' },
  { path: 'src/index.ts', name: 'index.ts' },
];

function seedFiles(): void {
  useVaultStore.setState({ files: FILES });
}

describe('SidebarSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVaultStore.setState(useVaultStore.getInitialState(), true);
    seedFiles();
  });

  afterEach(() => {
    useVaultStore.setState(useVaultStore.getInitialState(), true);
  });

  it('输入框为受控、Search 图标 + placeholder 简体中文', () => {
    const onQueryChange = vi.fn();
    render(<SidebarSearch query="" onQueryChange={onQueryChange} />);
    const input = screen.getByLabelText('搜索文件');
    expect(input).toHaveAttribute('placeholder', '搜索文件…');
    fireEvent.change(input, { target: { value: 'read' } });
    expect(onQueryChange).toHaveBeenCalledWith('read');
  });

  it('Esc 清空查询', () => {
    const onQueryChange = vi.fn();
    render(<SidebarSearch query="read" onQueryChange={onQueryChange} />);
    fireEvent.keyDown(screen.getByLabelText('搜索文件'), { key: 'Escape' });
    expect(onQueryChange).toHaveBeenCalledWith('');
  });

  it('清空按钮（有查询时显示）清空查询', () => {
    const onQueryChange = vi.fn();
    render(<SidebarSearch query="x" onQueryChange={onQueryChange} />);
    fireEvent.click(screen.getByLabelText('清空搜索'));
    expect(onQueryChange).toHaveBeenCalledWith('');
  });

  it('IME 组合期 Enter（isComposing）不打开文件（铁律防御）', () => {
    render(<SidebarSearch query="read" onQueryChange={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText('搜索文件'), { key: 'Enter', isComposing: true });
    expect(openFileByPath).not.toHaveBeenCalled();
  });

  it('IME 组合期 Enter（keyCode 229）不打开文件', () => {
    render(<SidebarSearch query="read" onQueryChange={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText('搜索文件'), { key: 'Enter', keyCode: 229 });
    expect(openFileByPath).not.toHaveBeenCalled();
  });

  it('非组合期 Enter 打开首个命中文件', () => {
    render(<SidebarSearch query="read" onQueryChange={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText('搜索文件'), { key: 'Enter' });
    expect(openFileByPath).toHaveBeenCalledWith('notes/readme.md');
  });
});

describe('SearchResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVaultStore.setState(useVaultStore.getInitialState(), true);
    seedFiles();
  });

  afterEach(() => {
    useVaultStore.setState(useVaultStore.getInitialState(), true);
  });

  it('扁平结果：文件名 + 相对路径副文本，递归整库（不受树折叠态限制）', () => {
    render(<SearchResults query="md" />);
    expect(screen.getByText('readme.md')).toBeInTheDocument();
    expect(screen.getByText('notes/readme.md')).toBeInTheDocument();
    // 非 .md 命中不出现（index.ts 不含 md）
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
  });

  it('CJK 文件名命中（ufuzzy unicode，复用 rankFiles）', () => {
    render(<SearchResults query="设计" />);
    expect(screen.getByText('设计稿.md')).toBeInTheDocument();
  });

  it('点击结果经 fileOpenFlow.openFileByPath 打开（相对路径）', () => {
    render(<SearchResults query="index" />);
    fireEvent.click(screen.getByRole('option', { name: /index\.ts/ }));
    expect(openFileByPath).toHaveBeenCalledWith('src/index.ts');
  });

  it('无命中给简体中文提示', () => {
    render(<SearchResults query="zzzzz不存在" />);
    expect(screen.getByText('没有匹配的文件')).toBeInTheDocument();
  });
});
