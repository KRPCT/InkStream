import { STATUS_LABEL, STATUS_TOKEN } from '../../editor/chapterTree';
import { useChapterTreeStore } from '../../stores/useChapterTreeStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { useSceneSummaryStore } from '../../stores/useSceneSummaryStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';

export default function CreativeStatusIndicator() {
  const mode = useWorkbenchStore((state) => state.mode);
  const vault = useVaultStore((state) => state.vault);
  const tree = useChapterTreeStore();
  const active = useEditorStore((state) => state.activePath);
  const scene = useSceneSummaryStore();
  if (mode !== 'creative' || !vault) return null;
  const ready = tree.scope === vault && !tree.loading && !tree.error;
  const chapters = ready ? tree.chapters.filter((chapter) => chapter.path !== null).length : 0;
  const scenes = ready ? tree.chapters.flatMap((chapter) => chapter.scenes) : [];
  const selected = scenes.some((item) => item.path === active) && scene.sourcePath === active;
  return <span className="flex h-full items-center gap-2 border-l border-[var(--background-modifier-border)] px-2">
    <span>{ready ? `${chapters} 章 · ${scenes.length} 场景` : tree.error ? '章节读取失败' : '正在读取章节…'}</span>
    {selected && <span className="flex items-center gap-1"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: scene.status ? STATUS_TOKEN[scene.status] : 'var(--text-muted)' }} />{scene.status ? STATUS_LABEL[scene.status] : '状态未解析'}</span>}
  </span>;
}
