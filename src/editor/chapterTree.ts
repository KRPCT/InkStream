import { readFile } from '../ipc/files';
import { listDir } from '../ipc/vault';
import { countWords } from '../lib/wordCount';
import type { ChapterNode, SceneNode, SceneStatus } from '../types/creative';
import { bodyStart, readFields } from './frontmatter';

/**
 * 章节-场景树构建（CREA-01）。文件夹=章、其内 .md=场景；顶层散 .md 归入「未分章」（决策：folder/file 模型）。
 *
 * v1 全客户端：listDir 枚举结构 + readFile per scene 取 frontmatter(title/status) 与正文字数
 * （决策 #13：数百场景够用，FTS5 列后置）。调用方 memoize + 仅 vault 变更重建（非每键），活动场景字数另由
 * useWordCountStore 实时叠加。字数用 lib/wordCount.countWords，与 StatusBar 同源（CREA-04）。
 */

const STATUSES: readonly SceneStatus[] = ['draft', 'revised', 'final'];
function toStatus(v: string | undefined): SceneStatus {
  return STATUSES.includes(v as SceneStatus) ? (v as SceneStatus) : 'draft';
}

/** 状态中文标签 + 色点 token（组件消费；色值入 theme.css，不硬编）。 */
export const STATUS_LABEL: Record<SceneStatus, string> = {
  draft: '草稿',
  revised: '已修',
  final: '定稿',
};
export const STATUS_TOKEN: Record<SceneStatus, string> = {
  draft: 'var(--crea-status-draft)',
  revised: 'var(--crea-status-revised)',
  final: 'var(--crea-status-final)',
};

const MD = /\.(md|markdown|txt)$/i;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sceneName(file: string, title?: string): string {
  return title ?? file.replace(MD, '');
}

/** 读一个场景文件 → SceneNode。读失败回退（名取文件名、draft、0 字），不阻断整树。 */
async function readScene(root: string, relPath: string, file: string): Promise<SceneNode> {
  try {
    const doc = await readFile(root, relPath);
    const f = readFields(doc, ['title', 'status']);
    return {
      path: relPath,
      name: sceneName(file, f.title),
      status: toStatus(f.status),
      words: countWords(doc.slice(bodyStart(doc))),
    };
  } catch {
    return { path: relPath, name: sceneName(file), status: 'draft', words: 0 };
  }
}

/** 构建章节树。隐藏点开头项（.git/.inkstream）；文件夹/文件按 Intl.Collator 序（同 FileTree）。 */
export async function buildChapterTree(root: string): Promise<ChapterNode[]> {
  const top = (await listDir(root, '')).filter((e) => !e.name.startsWith('.'));
  const dirs = top.filter((e) => e.isDir).sort((a, b) => collator.compare(a.name, b.name));
  const looseFiles = top
    .filter((e) => !e.isDir && MD.test(e.name))
    .sort((a, b) => collator.compare(a.name, b.name));

  const chapters: ChapterNode[] = [];
  for (const dir of dirs) {
    const entries = (await listDir(root, dir.name))
      .filter((e) => !e.isDir && MD.test(e.name))
      .sort((a, b) => collator.compare(a.name, b.name));
    const scenes = await Promise.all(
      entries.map((e) => readScene(root, `${dir.name}/${e.name}`, e.name)),
    );
    if (scenes.length > 0) chapters.push({ name: dir.name, path: dir.name, scenes });
  }
  if (looseFiles.length > 0) {
    const scenes = await Promise.all(looseFiles.map((e) => readScene(root, e.name, e.name)));
    chapters.push({ name: '未分章', path: null, scenes });
  }
  return chapters;
}
