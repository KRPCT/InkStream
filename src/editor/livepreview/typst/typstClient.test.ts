import { beforeEach, describe, expect, it } from 'vitest';
import { ERROR_SENTINEL, __setTypstForTest, getCachedSvg, typstReady } from './typstClient';

/** typstClient 缓存/就绪态回归门（Phase 5 W3）。真 Worker + wasm 编译走 CDP/E2E，此处只验纯状态逻辑。 */

beforeEach(() => __setTypstForTest(false)); // 重置 ready + 清缓存

describe('typstClient', () => {
  it('初始未就绪、缓存空', () => {
    expect(typstReady()).toBe(false);
    expect(getCachedSvg('x')).toBeNull();
  });

  it('注入就绪态 + 源→svg 缓存', () => {
    __setTypstForTest(true, { src: '<svg/>' });
    expect(typstReady()).toBe(true);
    expect(getCachedSvg('src')).toBe('<svg/>');
  });

  it('ERROR_SENTINEL 区别于成功 SVG 与未请求(null)', () => {
    expect(ERROR_SENTINEL).not.toBe('');
    __setTypstForTest(true, { bad: ERROR_SENTINEL });
    expect(getCachedSvg('bad')).toBe(ERROR_SENTINEL);
    expect(getCachedSvg('never')).toBeNull();
  });
});
