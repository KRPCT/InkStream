import { getInitialOpenFile, onOpenFile } from '../ipc/events';
import { windowControls } from '../ipc/window';
import { openExternalFile } from './fileOpenFlow';
import { basename, stripVerbatim } from './pathUtil';
import { isAutoReadingFormat, openReading } from './reading/openReading';

/**
 * OS 文件接入（#6）：把三条系统入口统一汇到 openExternalFile（库内→相对、库外→external tab，不切工作区）。
 * 1) 拖拽：把文件拖到窗口（onDragDrop 的 'drop'）；
 * 2) 「打开方式」冷启动：app 未运行时被启动，argv 里的文件（getInitialOpenFile）；
 * 3) 「打开方式」热转发：app 已运行时再次被启动，Rust 单实例回调发 inkstream://open-file。
 *
 * 代际令牌（同 externalChange 范式）防 StrictMode 双订阅泄漏。md/markdown/txt 入编辑器；docx/epub/pdf
 * 入阅读模式覆盖层（二进制不可编辑）；其余 / 文件夹忽略，避免对二进制 readFile 报错糊脸。
 */
let unlistenDrop: (() => void) | null = null;
let unlistenOpen: (() => void) | null = null;
let generation = 0;

function isEditableFile(path: string): boolean {
  return /\.(md|markdown|txt)$/i.test(path);
}

/** 单文件路由：docx/epub/pdf → 阅读覆盖层；md/markdown/txt → 编辑器；其余忽略。 */
function routeOne(path: string): Promise<void> {
  if (isAutoReadingFormat(path)) {
    const clean = stripVerbatim(path);
    openReading(clean, basename(clean));
    return Promise.resolve();
  }
  if (isEditableFile(path)) return openExternalFile(path);
  return Promise.resolve();
}

async function routePaths(paths: string[]): Promise<void> {
  for (const p of paths) await routeOne(p);
}

/** 启动 OS 文件接入订阅（App 挂载时调）。幂等：重复调用先解订阅。 */
export function initOsFileOpen(): void {
  stopOsFileOpen();
  const myGen = generation;
  void windowControls
    .onDragDrop((payload) => {
      if (payload.type === 'drop' && Array.isArray(payload.paths)) void routePaths(payload.paths);
    })
    .then((fn) => {
      if (generation !== myGen) {
        fn();
        return;
      }
      unlistenDrop = fn;
    });
  void onOpenFile((path) => {
    void routeOne(path);
  }).then((fn) => {
    if (generation !== myGen) {
      fn();
      return;
    }
    unlistenOpen = fn;
  });
  // 冷启动「打开方式」：取一次启动文件参数并打开（消费式，无则 null）。
  void getInitialOpenFile()
    .then((path) => {
      if (path) void routeOne(path);
    })
    .catch(() => {});
}

/** 解订阅（测试复位 / 卸载）。自增代际令牌，使在途订阅解析后自解。 */
export function stopOsFileOpen(): void {
  generation += 1;
  if (unlistenDrop) {
    unlistenDrop();
    unlistenDrop = null;
  }
  if (unlistenOpen) {
    unlistenOpen();
    unlistenOpen = null;
  }
}
