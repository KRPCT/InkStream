import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

/**
 * 自动更新通道（Tauri 2 updater + process）。全项目唯一接触 @tauri-apps/plugin-updater / -process 的文件
 * （ipc/ 收口立约）。check() 在非打包 / dev 运行时会抛——一律 try/catch 降级为「无更新」（同 getAppVersion）。
 * 待装更新的 Update 句柄（不可序列化）留在本模块，绝不进 store（同 editorState 持 EditorState 纪律）。
 */

let pending: Update | null = null;

export interface UpdateInfo {
  status: 'update' | 'none' | 'error';
  version?: string;
}

/**
 * 检查更新。区分三态：update（有更新）/ none（已最新）/ error（dev/非打包/无网——check() 抛被吞）。
 * 区分 error 与 none 让手动检查能给「检查失败」而非误报「已是最新」（启动静默检查则两者都静默）。
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const update = await check();
    pending = update;
    return update ? { status: 'update', version: update.version } : { status: 'none' };
  } catch {
    pending = null;
    return { status: 'error' };
  }
}

/** 下载并安装待装更新；onProgress(已下载字节, 总字节|null)。完成后须调 relaunchApp 重启。 */
export async function installPending(
  onProgress: (downloaded: number, total: number | null) => void,
): Promise<void> {
  if (!pending) throw new Error('无待装更新');
  let downloaded = 0;
  let total: number | null = null;
  await pending.downloadAndInstall((event) => {
    if (event.event === 'Started') total = event.data.contentLength ?? null;
    else if (event.event === 'Progress') downloaded += event.data.chunkLength;
    onProgress(downloaded, total);
  });
}

/** 安装后重启应用（更新生效）。 */
export async function relaunchApp(): Promise<void> {
  await relaunch();
}
