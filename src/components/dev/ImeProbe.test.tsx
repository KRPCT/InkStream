import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { getAll } from '../../commands/registry';
import ImeProbe from './ImeProbe';
import { registerImeProbeCommand } from './imeProbeCommand';
import { ZONES } from './imeProbeZones';
import { useImeProbeStore } from './useImeProbeStore';

/**
 * R2「一轮二分定位器」探针回归门。
 *
 * jsdom 不驱动真实 IME（无 view.composing / TSF），故本套不验「中文能否上屏」（那是手动 Windows+WebView2
 * 验收）；只锁工程契约：8 区全渲染、CM 区挂载即 EditorView 实例存在、卸载 destroy 被调、日志记录事件。
 */

describe('ImeProbe（A–H 二分 + I/J/K 候选解法）', () => {
  beforeEach(() => {
    useImeProbeStore.setState({ open: false });
  });

  afterEach(() => {
    useImeProbeStore.setState({ open: false });
  });

  it('面板关闭时不渲染任何受试区', () => {
    render(<ImeProbe />);
    expect(screen.queryByLabelText('A 受试区')).not.toBeInTheDocument();
  });

  it('打开后 12 个受试区 A–K+M 全渲染', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    expect(ZONES).toHaveLength(12);
    expect(ZONES.map((z) => z.id)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
      'K',
      'M',
    ]);
    for (const z of ZONES) {
      expect(screen.getByLabelText(`${z.id} 区事件日志`)).toBeInTheDocument();
    }
    // A=textarea、B/C=contentEditable、D–K=CM6（容器内 .cm-editor）
    expect(screen.getByLabelText('A 受试区').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('B 受试区')).toHaveAttribute('contenteditable', 'true');
    expect(screen.getByLabelText('C 受试区')).toHaveAttribute('contenteditable', 'true');
  });

  it('I/J/K 候选解法区均为 CM6 + setup 接线（K 额外铺中继 textarea）', () => {
    useImeProbeStore.setState({ open: true });
    const { container } = render(<ImeProbe />);
    for (const id of ['I', 'J', 'K']) {
      const zone = ZONES.find((z) => z.id === id);
      expect(zone?.kind).toBe('cm');
      expect(typeof zone?.setup).toBe('function');
    }
    // K 区在 CM 容器内动态挂入透明中继 textarea（绝对定位铺满）。
    expect(container.querySelector('textarea[data-relay-input]')).toBeInTheDocument();
  });

  it('M 区：register 对准中继 textarea（转焦即落焦输入面），contentDOM 不可聚焦', () => {
    useImeProbeStore.setState({ open: true });
    const { container } = render(<ImeProbe />);
    const relay = container.querySelector<HTMLTextAreaElement>('textarea[data-relay-m-input]');
    expect(relay).toBeInTheDocument();
    // 修 K 根因 1：转焦按钮聚焦的是 textarea（唯一焦点面），不是不可聚焦的 contentDOM。
    fireEvent.click(screen.getByText('转焦到 M'));
    expect(document.activeElement).toBe(relay);
    // M 区 CM 渲染层 editable=false → contenteditable="false"（天然不可聚焦）。
    const mHost = relay?.closest('.cm-probe-host');
    expect(mHost?.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'false');
    // 落子读数独立于事件日志（修 K 根因 2 的观测盲区）。
    expect(mHost?.querySelector('[data-relay-m-doc]')).toBeInTheDocument();
  });

  it('C 区照抄 CM6 .cm-content 全套属性（来源 view@6.43.1 updateAttrs）', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    const c = screen.getByLabelText('C 受试区');
    expect(c).toHaveAttribute('role', 'textbox');
    expect(c).toHaveAttribute('aria-multiline', 'true');
    expect(c).toHaveAttribute('spellcheck', 'false');
    expect(c).toHaveAttribute('autocorrect', 'off');
    expect(c).toHaveAttribute('autocapitalize', 'off');
    expect(c).toHaveAttribute('translate', 'no');
    expect(c).toHaveAttribute('writingsuggestions', 'false');
    expect(c.className).toContain('cm-content');
    expect(c.className).toContain('cm-lineWrapping');
  });

  it('CM 区（D–K+M）挂载即各持一个真实 EditorView 实例', () => {
    useImeProbeStore.setState({ open: true });
    const { container } = render(<ImeProbe />);
    const cmZones = ZONES.filter((z) => z.kind === 'cm');
    expect(cmZones).toHaveLength(9);
    // 每个 CM 区容器内恰好一个 .cm-editor（throwaway EditorView 已挂入 contentDOM）
    expect(container.querySelectorAll('.cm-editor')).toHaveLength(cmZones.length);
    expect(container.querySelectorAll('.cm-content')).toHaveLength(
      // C 区也带 cm-content class（照抄），故 = CM 区数 + 1
      cmZones.length + 1,
    );
  });

  it('卸载时每个 throwaway EditorView 的 destroy 都被调用', () => {
    const destroySpy = vi.spyOn(EditorView.prototype, 'destroy');
    useImeProbeStore.setState({ open: true });
    const { unmount } = render(<ImeProbe />);
    const before = destroySpy.mock.calls.length;
    act(() => unmount());
    const cmCount = ZONES.filter((z) => z.kind === 'cm').length;
    expect(destroySpy.mock.calls.length - before).toBeGreaterThanOrEqual(cmCount);
    destroySpy.mockRestore();
  });

  it('事件日志记录 composition 事件（捕获阶段，带 data）', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    const textarea = screen.getByLabelText('A 受试区');
    fireEvent.compositionStart(textarea, { data: '' });
    fireEvent.compositionUpdate(textarea, { data: 'ce' });
    fireEvent.compositionEnd(textarea, { data: '测试' });
    const log = screen.getByLabelText('A 区事件日志');
    expect(log.textContent).toContain('compositionstart');
    expect(log.textContent).toContain('compositionupdate');
    expect(log.textContent).toContain('compositionend');
    expect(log.textContent).toContain('测试');
  });

  it('keydown 日志记录 isComposing（IME 判据可见）', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    const textarea = screen.getByLabelText('A 受试区');
    fireEvent.keyDown(textarea, { key: 'a', isComposing: true });
    expect(screen.getByLabelText('A 区事件日志').textContent).toContain('isComposing=true');
  });

  it('日志只保留最近 10 条', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    const textarea = screen.getByLabelText('A 受试区');
    for (let i = 0; i < 15; i += 1) {
      fireEvent.keyDown(textarea, { key: String(i), isComposing: false });
    }
    expect(screen.getByLabelText('A 区事件日志').querySelectorAll('li')).toHaveLength(10);
  });

  it('日志面板防误触：mousedown 被 preventDefault（点击不夺焦）', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    const ev = fireEvent.mouseDown(screen.getByLabelText('A 区事件日志'));
    expect(ev).toBe(false);
  });

  it('转焦按钮程序化聚焦到对应受试区（A 区 textarea）', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    // 先把焦点移走，再点转焦按钮验证程序化转焦生效。
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(screen.getByText('转焦到 A'));
    expect(document.activeElement).toBe(screen.getByLabelText('A 受试区'));
  });
});

describe('registerImeProbeCommand（生产命令集不漂移）', () => {
  it('DEV 下注册唯一 dev.ime-probe 命令，标题文案不变，dispose 后注销', () => {
    expect(import.meta.env.DEV).toBe(true);
    const dispose = registerImeProbeCommand();
    const probes = getAll().filter((c) => c.id === 'dev.ime-probe');
    expect(probes).toHaveLength(1);
    expect(probes[0].title).toBe('开发：IME 输入探针');

    probes[0].run();
    expect(useImeProbeStore.getState().open).toBe(true);

    dispose();
    expect(getAll().some((c) => c.id === 'dev.ime-probe')).toBe(false);
    useImeProbeStore.setState({ open: false });
  });
});
