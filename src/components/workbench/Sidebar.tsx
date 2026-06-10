import { Folder } from 'lucide-react';
import EmptyState from '../common/EmptyState';

/** Sidebar 插槽：本阶段为占位空态，文件树属 Phase 2。1px 分隔线由 Separator 绘制。 */
export default function Sidebar() {
  return (
    <div className="h-full bg-[var(--background-secondary)]">
      <EmptyState icon={Folder} heading="未打开工作区" body="文件树会在打开文件夹后显示在这里。" />
    </div>
  );
}
