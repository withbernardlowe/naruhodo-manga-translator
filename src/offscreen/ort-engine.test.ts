import { describe, expect, it } from 'vitest';
import { sessionExecutionProviders, startKvDecoding, topCandidates, type KvSession, type KvTensor } from './ort-engine.ts';

describe('sessionExecutionProviders', () => {
  it('WebGPU 模式下 detector 走 wasm，encoder／cross_kv／decoder 走 WebGPU（#196）', () => {
    expect(sessionExecutionProviders('webgpu')).toEqual({ detector: 'wasm', encoder: 'webgpu', crossKv: 'webgpu', decoder: 'webgpu' });
  });

  it('wasm 模式所有模型都走 wasm', () => {
    expect(sessionExecutionProviders('wasm')).toEqual({ detector: 'wasm', encoder: 'wasm', crossKv: 'wasm', decoder: 'wasm' });
  });
});

/** 假的 tensor：記下有沒有被釋放。 */
interface FakeTensor extends KvTensor {
  name: string;
  disposed: boolean;
}

function fakeTensor(name: string, data: Float32Array | BigInt64Array, dims: readonly number[]): FakeTensor {
  const t: FakeTensor = { name, data, dims, disposed: false, dispose: () => void (t.disposed = true) };
  return t;
}

const CROSS = ['cross_key_0', 'cross_value_0', 'cross_key_1', 'cross_value_1'];
const PAST = ['past_key_0', 'past_value_0', 'past_key_1', 'past_value_1'];
const PRESENT = ['present_key_0', 'present_value_0', 'present_key_1', 'present_value_1'];
const VOCAB = 7;

/** 假的 cross_kv 與 decoder_with_past：記下每次 run 收到的 feeds，present 的長度＝past 的長度＋1。 */
function fakeSessions(n: number) {
  const crossFeeds: Record<string, KvTensor>[] = [];
  const decoderFeeds: Record<string, KvTensor>[] = [];
  const crossOutputs: FakeTensor[] = [];
  const presents: FakeTensor[][] = [];
  const crossKv: KvSession = {
    async run(feeds) {
      crossFeeds.push(feeds);
      // 內容只取幾個值：測的是有沒有複製，不是大小
      const out = CROSS.map((name, i) => fakeTensor(name, Float32Array.from([i, i + 1, i + 2]), [n, 12, 197, 64]));
      crossOutputs.push(...out);
      return Object.fromEntries(out.map((t) => [t.name, t]));
    },
  };
  const decoder: KvSession = {
    async run(feeds) {
      decoderFeeds.push(feeds);
      const pastLength = feeds.past_key_0!.dims[2]!;
      const present = PRESENT.map((name) => fakeTensor(name, new Float32Array(0), [n, 12, pastLength + 1, 64]));
      presents.push(present);
      const logits = fakeTensor('logits', Float32Array.from({ length: n * VOCAB }, (_, i) => i), [n, 1, VOCAB]);
      return { logits, ...Object.fromEntries(present.map((t) => [t.name, t])) };
    },
  };
  return { crossKv, decoder, crossFeeds, decoderFeeds, crossOutputs, presents };
}

describe('KV cache 的解碼（#317）', () => {
  const n = 2;
  const hidden = fakeTensor('hidden', new Float32Array(0), [n, 197, 768]);

  it('cross K/V 整頁只算一次；第一步的 past 長度 0，每步只餵新的一個 token', async () => {
    const s = fakeSessions(n);
    const decoding = await startKvDecoding(fakeTensor.bind(null, 'feed'), s, hidden, n, { copyCross: false });

    await decoding.step(BigInt64Array.from([2n, 2n]));
    await decoding.step(BigInt64Array.from([10n, 11n]));

    expect(s.crossFeeds).toEqual([{ encoder_hidden_states: hidden }]);
    const [first, second] = s.decoderFeeds;
    expect(first!.input_ids!.dims).toEqual([n, 1]);
    expect([...(second!.input_ids!.data as BigInt64Array)]).toEqual([10n, 11n]);
    for (const name of PAST) expect(first![name]!.dims).toEqual([n, 12, 0, 64]);
    // 第二步的 past 就是第一步的 present
    PAST.forEach((name, i) => expect(second![name]).toBe(s.presents[0]![i]));
    CROSS.forEach((name, i) => expect(first![name]).toBe(s.crossOutputs[i]));
  });

  it('logits 是 [n, 1, 字表]：每個框的這一步從 k × 字表 起', async () => {
    const s = fakeSessions(n);
    const decoding = await startKvDecoding(fakeTensor.bind(null, 'feed'), s, hidden, n, { copyCross: false });

    const { logits, vocabSize } = await decoding.step(BigInt64Array.from([2n, 2n]));

    expect(vocabSize).toBe(VOCAB);
    expect(logits[1 * vocabSize]).toBe(VOCAB);
  });

  it('上一步的 past 用完就釋放；結束時釋放最後的 past 與 cross K/V', async () => {
    const s = fakeSessions(n);
    const decoding = await startKvDecoding(fakeTensor.bind(null, 'feed'), s, hidden, n, { copyCross: false });

    await decoding.step(BigInt64Array.from([2n, 2n]));
    await decoding.step(BigInt64Array.from([10n, 11n]));
    expect(s.presents[0]!.every((t) => t.disposed)).toBe(true);
    expect(s.presents[1]!.some((t) => t.disposed)).toBe(false);
    expect(s.crossOutputs.some((t) => t.disposed)).toBe(false);

    decoding.release();

    expect(s.presents[1]!.every((t) => t.disposed)).toBe(true);
    expect(s.crossOutputs.every((t) => t.disposed)).toBe(true);
  });

  it('wasm 的 proxy 會把輸入 transfer 走：cross K/V 每步給一份新的複本', async () => {
    const s = fakeSessions(n);
    const decoding = await startKvDecoding(fakeTensor.bind(null, 'feed'), s, hidden, n, { copyCross: true });

    await decoding.step(BigInt64Array.from([2n, 2n]));
    await decoding.step(BigInt64Array.from([10n, 11n]));

    const [first, second] = s.decoderFeeds;
    CROSS.forEach((name, i) => {
      expect(first![name]).not.toBe(s.crossOutputs[i]);
      expect(first![name]!.data).not.toBe(second![name]!.data);
      expect(first![name]!.data).toEqual(s.crossOutputs[i]!.data);
      expect(first![name]!.dims).toEqual(s.crossOutputs[i]!.dims);
    });
  });
});

describe('topCandidates：解碼一步的前幾名候選（#228）', () => {
  it('照機率由高到低、最多 3 個；機率是整個字表的 softmax', () => {
    // 第二批（offset 5）的 logits：ln 4、0、ln 2、ln 3、0 → softmax 分母 4+1+2+3+1 = 11
    const logits = Float32Array.from([9, 9, 9, 9, 9, Math.log(4), 0, Math.log(2), Math.log(3), 0]);

    const top = topCandidates(logits, 5, 5);

    expect(top.map((c) => c.id)).toEqual([0, 3, 2]);
    expect(top.map((c) => c.probability)).toEqual([4 / 11, 3 / 11, 2 / 11].map((p) => expect.closeTo(p, 6)));
  });

  it('字表比 3 小時全部列出', () => {
    expect(topCandidates(Float32Array.from([0, 1]), 0, 2).map((c) => c.id)).toEqual([1, 0]);
  });
});
