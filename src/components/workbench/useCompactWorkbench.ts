import { useEffect, useState } from 'react';

const COMPACT_QUERY = '(max-width: 1100px)';
export function isCompactWorkbench(): boolean { return window.matchMedia(COMPACT_QUERY).matches; }

/** CSS and the layout write-back share the same breakpoint; narrow drawers are not saved as resized panels. */
export function useCompactWorkbench(): boolean {
  const [compact, setCompact] = useState(isCompactWorkbench);
  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY);
    const changed = () => setCompact(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  return compact;
}
