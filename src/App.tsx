import { useEffect } from 'react';
import AboutDialog from './components/common/AboutDialog';
import ConfirmDialog from './components/common/ConfirmDialog';
import Toast from './components/common/Toast';
import CommandPalette from './components/palette/CommandPalette';
import WorkbenchLayout from './components/workbench/WorkbenchLayout';
import { initExternalChangeArbiter, stopExternalChangeArbiter } from './editor/externalChange';
import { restoreLastVault } from './editor/startupFlow';
import { windowControls } from './ipc/window';
import { initPersistence } from './stores/persistSettings';
import { initVaultPersistence } from './stores/persistVault';

export default function App() {
  useEffect(() => {
    // 持久化 hydrate 先于 show() 发起、不阻塞首帧：首帧由 boot.js 镜像保证，
    // settings.json 到达后校正（Pattern 6 第 3 步）。initPersistence 幂等。
    void initPersistence();
    // vault 级持久化（D-08）：hydrate 最近列表 + 上次路径后，恢复上次 vault（D-07）。
    void initVaultPersistence().then(() => restoreLastVault());
    // 外部变更冲突仲裁订阅（D-04，FILE-02）：watcher 事件经此按 isDirty 双路径仲裁。
    initExternalChangeArbiter();
    // FOUC 契约第 1 步收尾：首帧渲染后显示窗口（show 幂等，StrictMode 双执行无害）
    void windowControls.show();
    return () => stopExternalChangeArbiter();
  }, []);

  return (
    <>
      <WorkbenchLayout />
      {/* 统一弹层：永挂载，显隐由 usePaletteStore.open 控制 */}
      <CommandPalette />
      {/* 关于对话框：app.about 命令打开（useAboutStore） */}
      <AboutDialog />
      {/* 破坏性确认模态：删除 / 覆盖磁盘二次确认（useConfirmStore，confirmDestructive 弹出） */}
      <ConfirmDialog />
      {/* Toast 通知宿主：错误/警告（useToastStore，持久化读写失败路径消费） */}
      <Toast />
    </>
  );
}
