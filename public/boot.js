/*
 * FOUC 首帧引导脚本（同步、阻塞，head 内经典 script 引入）。
 * React 挂载前读取 localStorage 'inkstream.boot' 镜像，设置 <html data-theme data-mode>。
 * 镜像仅影响首帧视觉；settings.json（Plan 06）为持久化真相源并在挂载后回校正。
 * 读入值做白名单收窄（threat T-01-05）：异常值一律落默认 system / standard。
 */
(function () {
  var THEMES = ['light', 'dark', 'system'];
  var MODES = ['standard', 'academic', 'creative'];
  var d = document.documentElement;
  var boot;
  try {
    boot = JSON.parse(localStorage.getItem('inkstream.boot') || '{}') || {};
  } catch {
    boot = {};
  }
  var theme = THEMES.indexOf(boot.theme) >= 0 ? boot.theme : 'system';
  var mode = MODES.indexOf(boot.mode) >= 0 ? boot.mode : 'standard';
  var resolved =
    theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  d.setAttribute('data-theme', resolved);
  d.setAttribute('data-mode', mode);
})();
