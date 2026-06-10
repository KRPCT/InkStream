import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerBuiltinCommands } from './commands/builtins';
import { init as initKeymap } from './commands/keymap';
import { initSettingsFromDocument } from './stores/useSettingsStore';
import './styles/app.css';

// 挂载前初始化设置状态：读取 boot.js 已设的 data-theme，避免首帧抖动
initSettingsFromDocument();
// 命令系统（SHELL-04）：内置命令注册（重复调用安全）+ 全局键位分发（幂等）
registerBuiltinCommands();
initKeymap();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
