import { compareFullText } from './compareText';

self.onmessage = (event: MessageEvent<{ oldText: string; newText: string }>) => {
  try { self.postMessage({ result: compareFullText(event.data.oldText, event.data.newText) }); }
  catch { self.postMessage({ error: '句级比较失败，完整正文仍可阅读。' }); }
};
