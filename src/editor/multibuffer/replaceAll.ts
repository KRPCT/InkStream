import { useEditorStore } from '../../stores/useEditorStore';
import { useProjectSearchStore } from '../../stores/useProjectSearchStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { readFile } from '../../ipc/files';
import { getDocForPath } from '../editorState';
import { findMatches, type MatchRange } from './projectSearch';
import { applyRangeEdits } from './multibufferWrite';

/**
 * 全库 replace-all 回写（#2c 1c，数据安全核心）。
 *
 * 纪律（经 4 视角调研定稿）：
 * - 命中**在当前真相源上重算**（getDocForPath ?? readFile），绝不信搜索时的旧偏移——搜索后文件可能已变；
 *   词已不在则静默跳过该文件（不按陈旧偏移写）。
 * - 回写收口到与主编辑器**同一份** per-path 缓冲：已打开文件经 applyEditsToOpenDoc（活动 dispatch / 后台
 *   更新缓存，保 undo）+ flushAutosave；未打开文件经 writeProjectFile 直写（不经 flushAutosave，否则按 null
 *   写空串）。两条路都不让 multibuffer 另持副本，杜绝双真相源 clobber（CR-01）。
 * - 冲突中的文件（frozen / externalChanged）一律跳过并计入报告，绝不覆盖用户未和解的外部变更（CR-03）。
 * - 无文件系统级多文件原子性：逐文件写，部分失败如实计入 report.failed，不假装 all-or-nothing。
 * - 撤销为逐文件（各自 EditorState 独立 history）——由确认框向用户言明，本层不做跨文件统一撤销。
 */

export interface ReplaceReport {
  /**
   * 成功改动的文件数。已打开文件计入即表示「已改入编辑器缓冲」——磁盘持久化由 autosave 串行链负责，
   * 其写失败会由 autosave 自身保脏 + error toast 上报（故此处不重复计入 failed）；未打开文件则真实反映落盘结果。
   */
  files: number;
  /** 替换的命中总数。 */
  replaced: number;
  /** 因 frozen / externalChanged 跳过的文件（写盘时刻实时判定，非循环开始的快照）。 */
  skipped: string[];
  /** 读失败 / 未打开文件落盘失败的文件。 */
  failed: string[];
}

function emptyReport(): ReplaceReport {
  return { files: 0, replaced: 0, skipped: [], failed: [] };
}

/** 对当前搜索结果集逐文件替换 term→replacement，返回结果报告。term<3 / 无 vault 一律空报告。 */
export async function replaceAllInProject(term: string, replacement: string): Promise<ReplaceReport> {
  const report = emptyReport();
  const t = term.trim();
  if (t.length < 3) return report;
  const root = useVaultStore.getState().vault?.root ?? null;
  if (root === null) return report;
  const results = useProjectSearchStore.getState().results;

  for (const fm of results) {
    const path = fm.path;
    // 写盘时刻实时判定冲突态（非循环开始的快照）：堵 TOCTOU——某文件在循环中途被冻结/标外部变更，
    // 此处仍能跳过，绝不覆盖用户未和解的外部变更（CR-03）。
    const { frozen, externalChanged } = useEditorStore.getState();
    if (frozen[path] || externalChanged[path]) {
      report.skipped.push(path);
      continue;
    }
    // 当前真相源（优先主编辑器内存内容），命中即时重算——不信搜索时旧偏移。
    const truth = getDocForPath(path) ?? (await readFile(root, path).catch(() => null));
    if (truth === null) {
      report.failed.push(path);
      continue;
    }
    const matches = findMatches(truth, t);
    if (matches.length === 0) continue; // 词已不在（搜索后被改）→ 静默跳过。
    const ok = await writeBack(path, truth, matches, replacement);
    if (ok) {
      report.files += 1;
      report.replaced += matches.length;
    } else {
      report.failed.push(path);
    }
  }
  return report;
}

/** 单文件回写：把全部命中替换为 replacement，收口到共享缓冲底座（applyRangeEdits，含 IME 安全 + 落盘路由）。 */
async function writeBack(
  path: string,
  truth: string,
  matches: MatchRange[],
  replacement: string,
): Promise<boolean> {
  return applyRangeEdits(
    path,
    truth,
    matches.map((m) => ({ from: m.from, to: m.to, insert: replacement })),
  );
}
