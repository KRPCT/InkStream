import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import { terminalClose, terminalOpen, terminalResize, terminalWrite } from '../../ipc/terminal';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useVaultStore } from '../../stores/useVaultStore';

/**
 * 内置终端宿主（v1.2 #3）：挂一个 xterm.js Terminal，经 PTY IPC 与系统 shell 双向通。
 *
 * 输出走 Channel（Rust 读线程 Raw 字节回传，term.write 自带跨块 UTF-8 解码）；键入经 onData→terminal_write；
 * 尺寸经 FitAddon + ResizeObserver→terminal_resize。xterm 自带 textarea 输入与 IME，**不**是 CM contentDOM，
 * 故主编辑器的 WebView2 IME 铁律在此不适用，可正常程序化聚焦。
 *
 * 生命周期严格配对（StrictMode）：建 Terminal + open 会话 / 卸载 dispose + terminal_close。open 为异步——
 * 若会话 id 在卸载后才 resolve，立即回收（终端已不在）。cwd 取当前工作区根（随 vault 变化重建会话）。
 */
export default function TerminalPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const vaultRoot = useVaultStore((s) => s.vault?.root ?? null);
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let sessionId: number | null = null;

    const term = new Terminal({
      fontFamily: 'var(--font-monospace, ui-monospace, monospace)',
      fontSize: 13,
      cursorBlink: true,
      theme: xtermTheme(),
      scrollback: 5000,
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    safeFit(fit);

    const onData = term.onData((data) => {
      if (sessionId !== null) void terminalWrite(sessionId, data);
    });
    const onResize = term.onResize(({ cols, rows }) => {
      if (sessionId !== null) void terminalResize(sessionId, cols, rows);
    });

    void terminalOpen({ cwd: vaultRoot, cols: term.cols, rows: term.rows }, (e) => {
      // 卸载后读线程仍可能有在途字节/退出帧（Channel 无 end 帧、onmessage 不自动注销）：一律丢弃，
      // 绝不写已 dispose 的 Terminal（否则 xterm 对已销毁核心服务抛异步异常）。
      if (disposed) return;
      if (e.kind === 'data') term.write(e.bytes);
      else term.write('\r\n\x1b[2m[进程已退出，关闭后重开可再次启动]\x1b[0m\r\n');
    })
      .then((id) => {
        if (disposed) {
          void terminalClose(id); // 卸载早于 open 解析：立即回收，绝不泄漏会话。
          return;
        }
        sessionId = id;
        term.focus();
      })
      .catch(() => {
        if (!disposed) term.write('\r\n\x1b[31m无法启动终端。\x1b[0m\r\n');
      });

    const ro = new ResizeObserver(() => safeFit(fit));
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      onData.dispose();
      onResize.dispose();
      if (sessionId !== null) void terminalClose(sessionId);
      termRef.current = null;
      term.dispose();
    };
  }, [vaultRoot]);

  // 主题切换时活更新配色，不重建会话（避免丢终端历史）。
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme();
  }, [resolvedTheme]);

  return <div ref={hostRef} className="h-full w-full" />;
}

/** 容器零尺寸（首挂载/折叠瞬间）时 fit 会抛，吞掉——下一次 ResizeObserver 回调会补上。 */
function safeFit(fit: FitAddon): void {
  try {
    fit.fit();
  } catch {
    /* 容器尚无布局：忽略 */
  }
}

/** 从主题 CSS 变量构建 xterm 配色（随 resolvedTheme 变化时由副作用刷新）。 */
function xtermTheme(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => s.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--background-primary', '#1e1e1e'),
    foreground: v('--text-normal', '#d4d4d4'),
    cursor: v('--text-normal', '#d4d4d4'),
    selectionBackground: v('--background-modifier-hover', 'rgba(255,255,255,0.18)'),
  };
}
