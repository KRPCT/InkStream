import { useEffect, useRef } from 'react';
import { createComparisonView } from '../../editor/comparisonView';
import type { TextComparison } from '../../diff/compareText';
import { comparisonDisplayText } from '../../diff/compareText';

const NO_RANGES: TextComparison['oldRanges'] = [];
export default function ReadOnlyGitText({ text, label, side = 'old', ranges = NO_RANGES }: {
  text: string; label: string; side?: 'old' | 'new'; ranges?: TextComparison['oldRanges'];
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const view = createComparisonView(host.current, comparisonDisplayText(text), ranges, side, label);
    return () => view.destroy();
  }, [text, label, side, ranges]);
  return <div ref={host} className="h-full min-h-0 min-w-0 overflow-hidden" />;
}
