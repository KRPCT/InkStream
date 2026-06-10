import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initSettingsFromDocument } from './stores/useSettingsStore';
import './styles/app.css';

// 挂载前初始化设置状态：读取 boot.js 已设的 data-theme，避免首帧抖动
initSettingsFromDocument();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
