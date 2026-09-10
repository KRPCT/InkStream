/** One accepted navigation intent across disk reads, tab clicks and deferred IME swaps. */
let generation = 0;
let controller = new AbortController();
export function beginDocumentNavigation(): number {
  controller.abort();
  controller = new AbortController();
  return ++generation;
}
export const documentNavigationSignal = (request: number): AbortSignal =>
  request === generation ? controller.signal : AbortSignal.abort();
export const currentDocumentNavigation = (): number => generation;
export const isCurrentDocumentNavigation = (request: number): boolean => request === generation;
