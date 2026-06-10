import { useEffect } from 'react';
import AboutDialog from './components/common/AboutDialog';
import Toast from './components/common/Toast';
import CommandPalette from './components/palette/CommandPalette';
import WorkbenchLayout from './components/workbench/WorkbenchLayout';
import { windowControls } from './ipc/window';

export default function App() {
  useEffect(() => {
    // FOUC 契约第 1 步收尾：首帧渲染后显示窗口（show 幂等，StrictMode 双执行无害）
    void windowControls.show();
  }, []);

  return (
    <>
      <WorkbenchLayout />
      {/* 统一弹层：永挂载，显隐由 usePaletteStore.open 控制 */}
      <CommandPalette />
      {/* 关于对话框：app.about 命令打开（useAboutStore） */}
      <AboutDialog />
      {/* Toast 通知宿主：错误/警告（useToastStore，持久化读写失败路径消费） */}
      <Toast />
    </>
  );
}
