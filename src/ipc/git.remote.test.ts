import { beforeEach, describe, expect, it, vi } from 'vitest';

const streamed = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const plain = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('./invoke', () => ({ invoke: plain, invokeStreamed: streamed }));

import { useSettingsStore } from '../stores/useSettingsStore';
import { gitCancelClone, gitClone, gitFetch, gitPull, gitPush, gitStatus } from './git';

const progress = () => {};
const actions = [
  { name: 'fetch', run: () => gitFetch('/writing', 'origin', progress) },
  { name: 'push', run: () => gitPush('/writing', 'origin', 'main', progress) },
  { name: 'pull', run: () => gitPull('/writing', 'origin', 'main', progress) },
  { name: 'clone', run: () => gitClone('https://github.com/example/book.git', '/book', progress) },
];

describe('远程设置决定实际 Git 请求', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ gitRemoteMode: 'ssh', gitCustomServer: '' });
  });

  it.each(actions)('仅本地模式阻止 $name，不能先发请求再隐藏结果', async ({ run }) => {
    useSettingsStore.setState({ gitRemoteMode: 'local' });
    await expect(run()).rejects.toThrow('仅本地');
    expect(streamed).not.toHaveBeenCalled();
  });

  it('仅本地不阻止本地 Git 状态读取', async () => {
    useSettingsStore.setState({ gitRemoteMode: 'local' });
    await gitStatus('/writing');
    expect(plain).toHaveBeenCalledWith('git_status', { repoRoot: '/writing' });
  });

  it.each(['ssh', 'oauth'] as const)('%s 模式连同请求快照交给后端判定实际目标', async (mode) => {
    useSettingsStore.setState({ gitRemoteMode: mode });
    await gitFetch('/writing', 'origin', progress);
    expect(streamed).toHaveBeenCalledWith(
      'git_fetch',
      { repoRoot: '/writing', remote: 'origin', options: { mode, customServer: '' } },
      progress,
    );
  });

  it('自定义仓库地址明确传入每种远程动作，原 origin 名称不被修改', async () => {
    const customServer = 'https://git.example.test/team/book.git';
    useSettingsStore.setState({ gitRemoteMode: 'custom', gitCustomServer: `  ${customServer}  ` });
    for (const { run } of actions) await run();
    expect(streamed).toHaveBeenCalledTimes(4);
    for (const [, args] of streamed.mock.calls) {
      expect(args.options).toEqual({ mode: 'custom', customServer });
    }
    expect(streamed.mock.calls[0][1]).toMatchObject({ repoRoot: '/writing', remote: 'origin' });
    expect(plain).not.toHaveBeenCalled();
  });

  it.each(['', 'git.example.test', 'http://git.example.test/team/book.git', 'ext::command'])(
    '自定义目标 %j 不明确或不受支持时在发送前失败',
    async (customServer) => {
      useSettingsStore.setState({ gitRemoteMode: 'custom', gitCustomServer: customServer });
      await expect(gitPush('/writing', 'origin', 'main', progress)).rejects.toThrow('自定义');
      expect(streamed).not.toHaveBeenCalled();
    },
  );

  it('自定义 SSH 地址无需读取 GitHub 令牌，按配置快照传递', async () => {
    const customServer = 'git@git.example.test:team/book.git';
    useSettingsStore.setState({ gitRemoteMode: 'custom', gitCustomServer: customServer });
    await gitPull('/writing', 'origin', 'main', progress);
    expect(streamed).toHaveBeenCalledWith(
      'git_pull',
      { repoRoot: '/writing', remote: 'origin', branch: 'main', options: { mode: 'custom', customServer } },
      progress,
    );
  });

  it('克隆与取消共用调用方requestId，目标路径和mode快照交给有界原生命令', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    const url = 'git@github.com:owner/book.git';
    const dest = 'C:/projects/中文书稿';
    streamed.mockResolvedValueOnce(dest);
    plain.mockResolvedValueOnce(true);
    await expect(gitClone(url, dest, progress, requestId)).resolves.toBe(dest);
    expect(streamed).toHaveBeenCalledWith('git_clone_owned', { url, dest, requestId, options: { mode: 'ssh', customServer: '' } }, progress);
    await expect(gitCancelClone(requestId)).resolves.toBe(true);
    expect(plain).toHaveBeenCalledWith('git_cancel_clone', { requestId });
  });
});
