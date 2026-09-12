import { useEffect, useRef, useState } from 'react';
import { readImageBytes } from '../../ipc/files';

// Visible covers share a small admission queue instead of opening a stream per catalog item.
let activeReads = 0;
const reads: Array<() => void> = [];
function readCover(path: string, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const start = () => {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); reads.shift()?.(); return; }
      activeReads += 1;
      void readImageBytes(path, { signal }).then(resolve, reject).finally(() => { activeReads -= 1; reads.shift()?.(); });
    };
    if (activeReads < 2) start(); else reads.push(start);
  });
}

export default function ProjectCover({ name, path, large = false }: { name: string; path: string | null; large?: boolean }) {
  const host = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let observer: IntersectionObserver | null = null;
    const load = () => {
      observer?.disconnect();
      if (!path) return;
      void readCover(path, controller.signal).then((bytes) => {
        if (controller.signal.aborted) return;
        const data = new Uint8Array(bytes.length); data.set(bytes);
        const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
        objectUrl = URL.createObjectURL(new Blob([data], { type: types[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream' }));
        setImage({ path, url: objectUrl });
      }).catch(() => { /* An unavailable cover keeps the original typographic fallback. */ });
    };
    if (path && host.current && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) load(); });
      observer.observe(host.current);
    } else load();
    return () => { controller.abort(); observer?.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  return <span ref={host} className={`project-cover${large ? ' project-cover-large' : ''}`} aria-hidden="true">
    <span className="project-cover-rule" /><span className="project-cover-letter">{Array.from(name.trim() || '墨')[0]}</span>
    {image && image.path === path ? <img src={image.url} alt="" /> : null}
  </span>;
}
