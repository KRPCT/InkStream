import { useSettingsStore } from '../stores/useSettingsStore';
import type { GitRemoteOptions } from '../types/git';

/** 界面侧提前解释配置错误；Rust 仍对 Git 实际解析的目标作最终校验。 */
function explicitRemote(value: string): boolean {
  if (/\s|[\\\r\n]/.test(value) || /^[a-z]:/i.test(value)) return false;
  if (/^(https|ssh):\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return (
        !!url.hostname &&
        !!url.pathname.replace(/^\/+/, '') &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.protocol === 'ssh:' || !url.username)
      );
    } catch {
      return false;
    }
  }
  if (value.includes('://')) return false;
  const scp = /^(?:[\w.-]+@)?(?:\[[\da-f:]+\]|[\w][\w.-]*):([^\s\\?#]+)$/i.exec(value);
  return scp !== null && !scp[1].startsWith(':');
}

/** 在动作开始时捕获设置，切换设置不会改变已经发出的请求。 */
export function gitRemoteOptions(): GitRemoteOptions {
  const { gitRemoteMode: mode, gitCustomServer } = useSettingsStore.getState();
  if (mode === 'local') throw new Error('当前为仅本地模式；请在设置中选择远程方式后再同步。');
  const customServer = mode === 'custom' ? gitCustomServer.trim() : '';
  if (mode === 'custom' && !explicitRemote(customServer)) {
    throw new Error('请填写完整的自定义 HTTPS 或 SSH 仓库地址，不能只填写服务器主机名。');
  }
  return { mode, customServer };
}
