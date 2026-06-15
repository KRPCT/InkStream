import { useEffect, useRef, useState } from 'react';

/**
 * 测量元素内容尺寸（ResizeObserver）。返回 [ref, { width, height }]（像素，初始 0）。
 *
 * 用途：把实测像素高度喂给需要固定高度的虚拟列表——react-arborist 的 `<Tree>` 不传 height 时
 * 退回硬编码 500px，致高于 500px 的文件树被裁、根级散文件落在折叠线下不可见（#4）。
 * jsdom（测试）无 ResizeObserver：静默跳过，尺寸恒 0，调用方据此回退默认高度。
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
