import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { matchCommands } from '../../commands/match';
import { useVaultStore } from '../../stores/useVaultStore';
import { slashCommandSource } from './slashCommand';

/**
 * `[[` wiki-link 文件名 fuzzy 补全（Phase 4 W3 / LINK-02）。
 *
 * 输入 `[[` 后弹 vault 文件清单（取自 useVaultStore 快照，openVault 时填充），按文件名 uFuzzy 排序
 * （复用 commands/match.ts，支持中文）。选中插入 `[[文件名]]`（去 `.md`，Obsidian 风裸名；光标落 `]]` 后）。
 *
 * filter:false——已用 uFuzzy 预排序，关闭 CM 内置过滤（避免对 CJK 二次过滤打架）。
 */

/** 单次最多展示候选数（长 vault 防爆栈）。 */
const MAX_OPTIONS = 50;

/** `[[` 补全源：匹配光标前 `[[` + 正在输入的目标片段（未到 `]` / 换行）。 */
export function wikiLinkSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/\[\[[^\]\n]*$/);
  if (!m) return null;
  const { vault, files } = useVaultStore.getState();
  if (!vault || files.length === 0) return null;
  const query = m.text.slice(2).trim(); // 去前导 `[[`
  const ranked = matchCommands(
    query,
    files.map((f) => f.name),
  );
  const options = ranked.slice(0, MAX_OPTIONS).map((i) => {
    const f = files[i];
    const nameNoMd = f.name.endsWith('.md') ? f.name.slice(0, -3) : f.name;
    return { label: f.name, detail: f.path, apply: `[[${nameNoMd}]]` };
  });
  if (options.length === 0) return null;
  return { from: m.from, options, filter: false };
}

/** Live Preview 补全扩展：wiki-link `[[` 源 + slash `/` 命令源（Phase 5 W1 起并列）。 */
export const wikiLinkCompletion = autocompletion({ override: [wikiLinkSource, slashCommandSource] });
