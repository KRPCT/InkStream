/** One non-reentrant queue for document release, file identity changes and workspace transitions. */
let transitionTail: Promise<void> = Promise.resolve();

export function serializeDocumentTransition<T>(operation: () => Promise<T>): Promise<T> {
  const result = transitionTail.then(operation);
  transitionTail = result.then(() => undefined, () => undefined);
  return result;
}
