import type { CentralView } from './useWorkbenchStore';

/** 导航请求失去所需能力时回到编辑器；阅读与书架不受简易模式门控。 */
export function effectiveCentralView(
  view: CentralView,
  capabilities: { simpleMode: boolean; bookshelfEnabled: boolean },
): CentralView {
  if (view === 'bookshelf' && !capabilities.bookshelfEnabled) return 'editor';
  if (
    capabilities.simpleMode &&
    (view === 'references' || view === 'projectVersions' || view === 'gitGraph' || view === 'graph' || view === 'mergeResolve' || view === 'multibuffer')
  ) {
    return 'editor';
  }
  return view;
}
