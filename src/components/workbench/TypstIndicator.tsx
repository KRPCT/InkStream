import { Check, CircleAlert, LoaderCircle, Pause } from 'lucide-react';
import { useTypstStore } from '../../stores/useTypstStore';

export default function TypstIndicator() {
  const { session, revision, phase } = useTypstStore();
  if (phase === 'idle') return null;
  const pending = phase === 'loading' || phase === 'compiling';
  const Icon = pending ? LoaderCircle : phase === 'error' ? CircleAlert : phase === 'paused' ? Pause : Check;
  const text = { idle: '', paused: '已暂停', loading: '加载中', compiling: '编译中', partial: '部分预览', ready: '已编译', error: '编译失败' }[phase];
  return (
    <div data-testid="typst-indicator" data-document-session={session} data-revision={revision} role="status" className="flex h-full items-center gap-1.5 border-l border-[var(--background-modifier-border)] px-2" title={`Typst · ${text}`}>
      <Icon size={12} aria-hidden="true" className={pending ? 'animate-spin motion-reduce:animate-none' : undefined} />
      <span>Typst · {text}</span>
    </div>
  );
}
