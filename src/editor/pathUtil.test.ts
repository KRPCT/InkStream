import { describe, expect, it } from 'vitest';
import {
  basename,
  isAbsolutePath,
  normalizeSlash,
  parentDir,
  relativeWithin,
  stripVerbatim,
} from './pathUtil';

describe('pathUtil', () => {
  it('isAbsolutePath：盘符/POSIX/UNC 为绝对；相对路径与草稿为否', () => {
    expect(isAbsolutePath('D:/a/b.md')).toBe(true);
    expect(isAbsolutePath('D:\\a\\b.md')).toBe(true);
    expect(isAbsolutePath('/home/x.md')).toBe(true);
    expect(isAbsolutePath('\\\\srv\\share\\x.md')).toBe(true);
    expect(isAbsolutePath('notes/a.md')).toBe(false);
    expect(isAbsolutePath('a.md')).toBe(false);
    expect(isAbsolutePath('draft://1')).toBe(false);
  });

  it('basename / parentDir：统一分隔后取末段 / 父目录', () => {
    expect(basename('D:\\a\\b\\c.md')).toBe('c.md');
    expect(basename('notes/x.md')).toBe('x.md');
    expect(parentDir('D:\\a\\b\\c.md')).toBe('D:/a/b');
    expect(parentDir('notes/x.md')).toBe('notes');
  });

  it('relativeWithin：库内→相对路径；根自身/库外/共享前缀→null', () => {
    expect(relativeWithin('D:/Vault/notes/a.md', 'D:/Vault')).toBe('notes/a.md');
    expect(relativeWithin('D:\\Vault\\a.md', 'D:/Vault')).toBe('a.md');
    expect(relativeWithin('D:/Vault', 'D:/Vault')).toBe(null); // 根自身非其内文件
    expect(relativeWithin('D:/Other/a.md', 'D:/Vault')).toBe(null); // 库外
    expect(relativeWithin('D:/VaultX/a.md', 'D:/Vault')).toBe(null); // 共享前缀但非子路径
  });

  it('normalizeSlash：反斜杠归一为正斜杠', () => {
    expect(normalizeSlash('D:\\a\\b')).toBe('D:/a/b');
  });

  it('stripVerbatim：剥 \\\\?\\ / \\\\?\\UNC\\ 长路径前缀并归一为 /', () => {
    expect(stripVerbatim('\\\\?\\D:\\Vault\\a.md')).toBe('D:/Vault/a.md');
    expect(stripVerbatim('\\\\?\\UNC\\srv\\share\\a.md')).toBe('//srv/share/a.md');
    expect(stripVerbatim('D:\\Vault')).toBe('D:/Vault'); // 无前缀仅归一
    expect(stripVerbatim('/posix/a.md')).toBe('/posix/a.md');
  });

  it('relativeWithin：兼容 Windows verbatim 根（canonicalize 形）vs 对话框/拖拽干净路径', () => {
    // 干净文件路径（pickFile/拖拽）落在 verbatim 根内 → 必须判为库内（修 #5 误判库外）。
    expect(relativeWithin('D:/Vault/notes/a.md', '\\\\?\\D:\\Vault')).toBe('notes/a.md');
    expect(relativeWithin('D:\\Vault\\sub\\b.md', '\\\\?\\D:\\Vault')).toBe('sub/b.md');
    // UNC verbatim 根。
    expect(relativeWithin('//server/share/notes/a.md', '\\\\?\\UNC\\server\\share')).toBe(
      'notes/a.md',
    );
    // 库外仍判 null。
    expect(relativeWithin('D:/Other/a.md', '\\\\?\\D:\\Vault')).toBe(null);
  });
});
