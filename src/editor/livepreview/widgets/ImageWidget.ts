import { WidgetType } from '@codemirror/view';
import { assetUrl } from '../../../ipc/asset';

/**
 * 图片内联预览 widget（行内层 / D-09 / RESEARCH「图片内联预览」/ UI-SPEC Layout Contract 图片行）。
 *
 * 职责：把 `![](url)` 渲染为真 `<img>`：
 *   - 远程 `![](https://...)`：直接 `img.src = url`（CSP img-src 已放行 https:，Plan 02）；
 *   - 本地 `![](relative.png)`：相对当前文档目录解析为 vault 内绝对路径 → convertFileSrc → asset URL
 *     （CSP img-src 已放行 asset:，Plan 02）。
 *
 * 安全（T-03-19 / RESEARCH Security V12 / Q3 安全边界下移）：assetProtocol scope 为 broad `[**]`，
 * 故越 vault 读文件的防护**收口在本调用点**——`convertFileSrc` 仅对解析结果在 vault 根内的本地路径
 * 调用（`resolveVaultImage` 判定）。越界路径（`../../secret` / `file://` / 绝对盘符）一律不解析、
 * 渲染失败占位，绝不把任意绝对路径转成 asset URL（承 Phase 2 path_guard 纪律）。
 *
 * XSS（同 TableWidget 纪律）：DOM 全经 `document.createElement` 构建，文本经 textContent；url 仅作
 * `img.src` / `<a href>` 之外不进任何 innerHTML 或事件处理器属性——本阶段无 sanitizer 前提下的强制纪律。
 *
 * 性能（RESEARCH 性能纪律）：`eq(other)` 按原始 markdown url 比较——同 url 不重建 DOM（防图片闪烁）；
 * `img.loading = 'lazy'` + CM6 visibleRanges 双重懒加载。样式经 class 消费 var(--cm-image-loading-bg)
 * / var(--color-error)，**永不硬编码色值**（同 inlinePlugin / highlightTheme 纪律）。
 */

/** 图片 widget 的 vault 上下文：vault 根绝对路径 + 当前文档相对 vault 根的路径。 */
export interface ImageVaultContext {
  /** vault 根绝对路径（POSIX `/` 分隔，与 FileEntry.path 同纪律）。 */
  root: string;
  /** 当前文档相对 vault 根的路径（图片相对该文档目录解析）。 */
  docPath: string;
}

/** 图片 url 解析结果：远程直连 / vault 内本地绝对路径 / 越界或无法解析（不渲染图）。 */
export type ResolvedImage =
  | { kind: 'remote'; url: string }
  | { kind: 'local'; absPath: string }
  | { kind: 'invalid' };

/** 远程 scheme（直接 <img src>，受 CSP img-src https: 约束）。 */
const REMOTE_SCHEME = /^https?:\/\//i;

/**
 * 解析图片 url：远程直连 / 本地相对路径在 vault 内则给绝对路径 / 否则 invalid（安全边界下移，T-03-19）。
 *
 * 本地分支把相对路径按「当前文档所在目录」用 POSIX 段折叠（`.`/`..`）解析，再断言结果仍在 vault 根内
 * （`/vault` 或 `/vault/...`）——任何上跳越过根、绝对路径、带 scheme 的 url 一律 invalid，绝不交给
 * convertFileSrc（assetProtocol broad scope 的纪律收口点）。
 */
export function resolveVaultImage(url: string, vault: ImageVaultContext | null): ResolvedImage {
  if (REMOTE_SCHEME.test(url)) return { kind: 'remote', url };
  // 带 scheme（file:/data: 等）或绝对路径：非 vault 内相对图，拒解析。
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') || url.startsWith('\\')) {
    return { kind: 'invalid' };
  }
  if (!vault) return { kind: 'invalid' };

  // 当前文档所在目录（去掉文件名段）作为相对图基准目录。
  // 反斜杠与正斜杠同视为路径分隔符：Windows 风格 `..\..\` 须折叠才能被下方上跳越界判定识破（WR-01）。
  const docSegments = vault.docPath.split(/[\\/]/).filter(Boolean);
  docSegments.pop(); // 去掉文档文件名，留目录段。

  const stack = [...docSegments];
  for (const seg of url.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (stack.length === 0) return { kind: 'invalid' }; // 上跳越过 vault 根。
      stack.pop();
      continue;
    }
    stack.push(seg);
  }

  // vault.root 规范化（UAT 图片，Windows verbatim 根）：open_vault 在 Windows 返回
  // Path::canonicalize 的 verbatim 路径 `\\?\D:\...\vault`（反斜杠 + `\\?\` 前缀）。verbatim 前缀会
  // 禁用 asset 协议侧 `/`→`\` 翻译 → File::open 404 → 错误占位。镜像 externalChange.ts:toRelative
  // 的剥前缀 + 反斜杠转正斜杠，产出 `D:/.../vault`，asset 协议在 Windows 可解析。
  const rootClean = vault.root
    .replace(/^\\\\\?\\UNC\\/, '\\\\') // \\?\UNC\server\share -> \\server\share
    .replace(/^\\\\\?\\/, '') // \\?\D:\... -> D:\...
    .replace(/\\/g, '/') // 反斜杠 -> 正斜杠
    .replace(/\/+$/, ''); // 去尾随斜杠
  const absPath = stack.length > 0 ? `${rootClean}/${stack.join('/')}` : rootClean;
  return { kind: 'local', absPath };
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly vault: ImageVaultContext | null,
  ) {
    super();
  }

  /** 同原始 url 视为同一 widget：CM6 复用旧 DOM，不重建（防图片闪烁，RESEARCH 性能纪律）。 */
  eq(other: ImageWidget): boolean {
    return other.url === this.url;
  }

  toDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = 'cm-ink-image cm-ink-image-loading';

    const resolved = resolveVaultImage(this.url, this.vault);
    if (resolved.kind === 'invalid') {
      return renderError(container);
    }

    const img = document.createElement('img');
    img.setAttribute('loading', 'lazy');
    img.className = 'cm-ink-image-img';
    img.setAttribute('src', resolved.kind === 'remote' ? resolved.url : assetUrl(resolved.absPath));

    img.addEventListener('load', () => {
      container.classList.remove('cm-ink-image-loading');
    });
    img.addEventListener('error', () => {
      container.classList.remove('cm-ink-image-loading');
      renderError(container);
    });

    container.appendChild(img);
    return container;
  }
}

/**
 * 渲染失败态：清空容器 → 「无法加载图片」文案（次行 url --text-faint）+ --color-error 1px 描边 class。
 *
 * 文案经 textContent（XSS 纪律：url 作纯文本，绝不进 innerHTML/事件属性）。
 */
function renderError(container: HTMLElement): HTMLElement {
  container.classList.remove('cm-ink-image-loading');
  container.classList.add('cm-ink-image-error');
  container.replaceChildren();

  const label = document.createElement('span');
  label.className = 'cm-ink-image-error-label';
  label.textContent = '无法加载图片';
  container.appendChild(label);
  return container;
}
