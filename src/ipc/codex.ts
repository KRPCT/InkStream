import { invoke } from './invoke';

/** Exclusive creation writes the complete bounded entry; it never replaces an existing file. */
export function createCodexFile(root: string, path: string, content: string): Promise<null> {
  return invoke('create_text_file', { root, path, content });
}
