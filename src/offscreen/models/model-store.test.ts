import { describe, expect, it, vi } from 'vitest';
import { modelUrl, type ModelFile } from './model-files.ts';
import { createModelStore, missingFiles, type CacheLike, type DownloadProgress } from './model-store.ts';

/** sha256("hello")，獨立算好的值。 */
const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

const hello: ModelFile = { repo: 'someone/model', revision: 'abc123', path: 'onnx/hello.onnx', size: 5, sha256: HELLO_SHA256 };
const world: ModelFile = {
  repo: 'someone/model',
  revision: 'abc123',
  path: 'world.txt',
  size: 6,
  // sha256("world!")
  sha256: '711e9609339e92b03ddc0a211827dba421f38f9ed8b9d806e1ffdd8c15ffa03d',
};

function memoryCache(): CacheLike & { urls(): string[] } {
  const entries = new Map<string, ArrayBuffer>();
  return {
    async match(url) {
      const body = entries.get(url);
      return body ? new Response(body.slice(0)) : undefined;
    },
    async put(url, response) {
      entries.set(url, await response.arrayBuffer());
    },
    async keys() {
      return [...entries.keys()].map((url) => ({ url }));
    },
    async delete(url) {
      return entries.delete(url);
    },
    urls: () => [...entries.keys()],
  };
}

function fakeFetch(bodies: Record<string, string>) {
  return vi.fn(async (url: string) => {
    const body = Object.entries(bodies).find(([suffix]) => url.endsWith(suffix))?.[1];
    return body === undefined ? new Response('not found', { status: 404 }) : new Response(body);
  });
}

const text = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

describe('模型下載與快取', () => {
  it('第一次使用時從固定 revision 的網址下載，並存進快取', async () => {
    const fetch = fakeFetch({ 'hello.onnx': 'hello' });
    const cache = memoryCache();
    const store = createModelStore({ fetch, openCache: async () => cache });

    const [buffer] = await store.load([hello]);

    expect(text(buffer!)).toBe('hello');
    expect(fetch).toHaveBeenCalledWith('https://huggingface.co/someone/model/resolve/abc123/onnx/hello.onnx');
    expect(cache.urls()).toEqual(['https://huggingface.co/someone/model/resolve/abc123/onnx/hello.onnx']);
  });

  it('快取裡已經有的檔案不再下載', async () => {
    const cache = memoryCache();
    await createModelStore({ fetch: fakeFetch({ 'hello.onnx': 'hello' }), openCache: async () => cache }).load([hello]);
    const fetch = fakeFetch({});

    const [buffer] = await createModelStore({ fetch, openCache: async () => cache }).load([hello]);

    expect(text(buffer!)).toBe('hello');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SHA-256 不符時不使用、不存進快取，下次重新下載', async () => {
    const cache = memoryCache();
    const store = createModelStore({ fetch: fakeFetch({ 'hello.onnx': 'HELLO' }), openCache: async () => cache });

    await expect(store.load([hello])).rejects.toThrow(/SHA-256.*onnx\/hello\.onnx/);
    expect(cache.urls()).toEqual([]);

    const retry = createModelStore({ fetch: fakeFetch({ 'hello.onnx': 'hello' }), openCache: async () => cache });
    const [buffer] = await retry.load([hello]);
    expect(text(buffer!)).toBe('hello');
  });

  it('下載失敗（HTTP 錯誤）時回報錯誤', async () => {
    const store = createModelStore({ fetch: fakeFetch({}), openCache: async () => memoryCache() });

    await expect(store.load([hello])).rejects.toThrow(/404/);
  });

  it('回報需要下載的總大小與已下載的量；已在快取裡的不算', async () => {
    const cache = memoryCache();
    await createModelStore({ fetch: fakeFetch({ 'hello.onnx': 'hello' }), openCache: async () => cache }).load([hello]);
    const progress: DownloadProgress[] = [];
    const store = createModelStore({ fetch: fakeFetch({ 'hello.onnx': 'hello', 'world.txt': 'world!' }), openCache: async () => cache });

    await store.load([hello, world], (p) => progress.push(p));

    expect(progress[0]).toEqual({ loaded: 0, total: 6 });
    expect(progress.at(-1)).toEqual({ loaded: 6, total: 6 });
  });

  it('可以指定其他下載來源，快取的 key 仍是 Hugging Face 的網址', async () => {
    const fetch = fakeFetch({ 'hello.onnx': 'hello' });
    const cache = memoryCache();
    const store = createModelStore({ fetch, openCache: async () => cache, baseUrl: 'http://127.0.0.1:9999/hf' });

    await store.load([hello]);

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:9999/hf/someone/model/resolve/abc123/onnx/hello.onnx');
    expect(cache.urls()).toEqual(['https://huggingface.co/someone/model/resolve/abc123/onnx/hello.onnx']);
  });
});

describe('預先下載（#169）', () => {
  it('只下載進快取；已在快取裡的不再下載', async () => {
    const cache = memoryCache();
    const fetch = fakeFetch({ 'hello.onnx': 'hello' });
    const store = createModelStore({ fetch, openCache: async () => cache });

    await store.download([hello]);
    await store.download([hello]);

    expect(cache.urls()).toEqual(['https://huggingface.co/someone/model/resolve/abc123/onnx/hello.onnx']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('預先下載進行中時開始翻譯：接續同一個下載，不重抓，兩邊看到同一份進度', async () => {
    const cache = memoryCache();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetch = vi.fn(async (url: string) => {
      await gate;
      return new Response(url.endsWith('hello.onnx') ? 'hello' : 'world!');
    });
    const store = createModelStore({ fetch, openCache: async () => cache });
    const prefetched: DownloadProgress[] = [];
    const translating: DownloadProgress[] = [];

    const prefetch = store.download([hello, world], (p) => prefetched.push(p));
    const load = store.load([hello, world], (p) => translating.push(p));
    release();
    const [, buffers] = await Promise.all([prefetch, load]);

    expect(buffers.map(text)).toEqual(['hello', 'world!']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(prefetched.at(-1)).toEqual({ loaded: 11, total: 11 });
    expect(translating.at(-1)).toEqual({ loaded: 11, total: 11 });
    // 進度只有一份：數字只會往上，不會從 0 重來
    for (const progress of [prefetched, translating]) expect(progress.map((p) => p.loaded)).toEqual([...progress.map((p) => p.loaded)].sort((a, b) => a - b));
  });

  it('下載失敗後，下次照常重新下載', async () => {
    const cache = memoryCache();
    await expect(createModelStore({ fetch: fakeFetch({}), openCache: async () => cache }).download([hello])).rejects.toThrow(/404/);
    const store = createModelStore({ fetch: fakeFetch({ 'hello.onnx': 'hello' }), openCache: async () => cache });

    await store.download([hello]);

    expect(await missingFiles(cache, [hello])).toEqual([]);
  });

  it('missingFiles：列出還不在快取裡的檔案（SW 判斷已下載、算還要下載多少）', async () => {
    const cache = memoryCache();
    const store = createModelStore({ fetch: fakeFetch({ 'hello.onnx': 'hello' }), openCache: async () => cache });
    expect(await missingFiles(cache, [hello, world])).toEqual([hello, world]);

    await store.download([hello]);

    expect(await missingFiles(cache, [hello, world])).toEqual([world]);
  });
});

describe('清掉舊版留下的模型檔（#317）', () => {
  const old: ModelFile = { ...hello, path: 'onnx/old_decoder.onnx', sha256: 'old' };
  const oldUrl = 'https://huggingface.co/someone/model/resolve/abc123/onnx/old_decoder.onnx';

  async function cacheWithOldFile() {
    const cache = memoryCache();
    await cache.put(modelUrl(old), new Response('old'));
    return cache;
  }

  it('下載完一組模型後，刪掉快取裡不屬於任何一組的檔案', async () => {
    const cache = await cacheWithOldFile();
    const store = createModelStore({ fetch: fakeFetch({ 'hello.onnx': 'hello' }), openCache: async () => cache, keep: [hello, world] });

    await store.download([hello]);

    expect(cache.urls()).toEqual(['https://huggingface.co/someone/model/resolve/abc123/onnx/hello.onnx']);
  });

  it('要保留的檔案不刪，即使不是這次下載的那一組（WebGPU 退回 wasm 時會用到）', async () => {
    const cache = await cacheWithOldFile();
    const store = createModelStore({ fetch: fakeFetch({ 'hello.onnx': 'hello' }), openCache: async () => cache, keep: [hello, old] });

    await store.download([hello]);

    expect(cache.urls()).toContain(oldUrl);
  });

  it('下載失敗時不刪：舊的檔案留到新的那組下載完為止', async () => {
    const cache = await cacheWithOldFile();
    const store = createModelStore({ fetch: fakeFetch({}), openCache: async () => cache, keep: [hello] });

    await expect(store.download([hello])).rejects.toThrow(/404/);

    expect(cache.urls()).toEqual([oldUrl]);
  });

  it('沒給要保留的檔案就不清（測試用的 store）', async () => {
    const cache = await cacheWithOldFile();
    const store = createModelStore({ fetch: fakeFetch({ 'hello.onnx': 'hello' }), openCache: async () => cache });

    await store.download([hello]);

    expect(cache.urls()).toContain(oldUrl);
  });
});
