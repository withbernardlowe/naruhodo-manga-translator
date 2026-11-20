import { describe, expect, it } from 'vitest';
import { ALL_MODEL_SET_FILES, MODEL_FILES, MODEL_SETS, modelSetBytes, modelSetFiles } from './model-files.ts';

describe('模型組（#317）', () => {
  it('兩組都用 KV cache decoder：WebGPU 用 fp32、wasm 用 q8，cross_kv 跟 decoder 同一種精度', () => {
    expect(MODEL_SETS.webgpu).toMatchObject({ crossKv: MODEL_FILES.crossKvFp32, decoder: MODEL_FILES.decoderFp32 });
    expect(MODEL_SETS.wasm).toMatchObject({ crossKv: MODEL_FILES.crossKvQ8, decoder: MODEL_FILES.decoderQ8 });
  });

  it('下載量跟 onboarding 說的一樣：WebGPU 約 472 MB、wasm 約 128 MB', () => {
    expect(Math.round(modelSetBytes(MODEL_SETS.webgpu) / 1_000_000)).toBe(472);
    expect(Math.round(modelSetBytes(MODEL_SETS.wasm) / 1_000_000)).toBe(128);
  });

  it('要保留的檔案是兩組的聯集，共用的 detector、vocab 只算一次', () => {
    const expected = new Set([...modelSetFiles(MODEL_SETS.webgpu), ...modelSetFiles(MODEL_SETS.wasm)]);
    expect(new Set(ALL_MODEL_SET_FILES)).toEqual(expected);
    expect(ALL_MODEL_SET_FILES).toHaveLength(expected.size);
  });
});
