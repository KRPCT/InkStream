import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 执行生产 helper 本身；源码读取仅装载 Rust 字符串，不用复制的测试实现证明自己正确。
// 无网络、无用户 gitconfig/keyring、无真实 token。每次 git 子进程有 5 秒硬超时。
function productionCredentialHelper(): string {
  const source = readFileSync(resolve('src-tauri/src/git/remote.rs'), 'utf8');
  const literal = source.match(/const CRED_HELPER:\s*&str\s*=\s*(r#"[\s\S]*?"#|"(?:\\.|[^"\\])*");/)?.[1];
  if (!literal) throw new Error('未找到生产 Git credential helper');
  return literal.startsWith('r#"') ? literal.slice(3, -2) : JSON.parse(literal);
}

const syntheticToken = 'fixture-only-token-no-account';

function requestCredential(protocol: string, host: string) {
  return spawnSync(
    'git',
    ['-c', 'credential.helper=', '-c', productionCredentialHelper(), 'credential', 'fill'],
    {
      cwd: tmpdir(),
      input: `protocol=${protocol}\nhost=${host}\npath=example/book.git\n\n`,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        COMSPEC: process.env.COMSPEC,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_CONFIG_COUNT: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        SSH_ASKPASS: '',
        GCM_INTERACTIVE: 'never',
        INKSTREAM_GH_TOKEN: syntheticToken,
        LANG: 'C',
        LC_ALL: 'C',
      },
    },
  );
}

describe('Git 实际 credential context 的 GitHub token 隔离', () => {
  it.each(['github.com', 'github.com:443'])('授权 HTTPS 主机 %s 可取得合成凭据', (host) => {
    const result = requestCredential('https', host);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('username=x-access-token');
    expect(result.stdout).toContain(`password=${syntheticToken}`);
  });

  it.each([
    ['https', 'git.example.test'],
    ['https', 'github.com.example.test'],
    ['https', 'github.com@evil.example.test'],
    ['https', 'github.com:8443'],
    ['http', 'github.com'],
    ['ssh', 'github.com'],
  ])('实际请求 %s://%s 不得获得 GitHub token', (protocol, host) => {
    const result = requestCredential(protocol, host);
    expect(result.error).toBeUndefined();
    expect(result.stdout).not.toContain(syntheticToken);
    expect(result.stdout).not.toContain('password=');
    expect(result.status).not.toBe(0);
  });
});
