import { useEffect } from 'react';
import { windowControls } from './ipc/window';

export default function App() {
  useEffect(() => {
    // FOUC 契约第 1 步收尾：首帧渲染后显示窗口（show 幂等，StrictMode 双执行无害）
    void windowControls.show();
  }, []);

  return (
    <div className="flex h-screen items-center justify-center">
      <p className="text-lg">InkStream / 墨流</p>
    </div>
  );
}
