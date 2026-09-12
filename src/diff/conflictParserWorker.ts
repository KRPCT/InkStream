import { parseConflicts } from './parseConflicts';
self.onmessage = (event: MessageEvent<string>) => { self.postMessage(parseConflicts(event.data)); };
