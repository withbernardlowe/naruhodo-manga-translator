/**
 * 第一次使用時下載的 ONNX 模型（spec #27 第 3.3 節）：固定 revision、驗證 SHA-256。
 * sha256 是 Hugging Face LFS 的 oid（vocab.txt 不是 LFS，是自己下載後算的）；2026-10-25 查 HF API。
 * detector repo 在 2026-05 重傳過同名檔案好幾次，所以一定要固定 revision。
 */
import type { ExecutionProvider } from '../../shared/messages.ts';

export type { ExecutionProvider };

export interface ModelFile {
  repo: string;
  revision: string;
  path: string;
  /** bytes，用來在下載前顯示大小。 */
  size: number;
  sha256: string;
}

const DETECTOR = { repo: 'ogkalu/comic-text-and-bubble-detector', revision: '16e8a622f91fabc6b5b65c96d32d1183f8843546' };
const OCR = { repo: 'onnx-community/manga-ocr-base-ONNX', revision: 'f9023406bb2f6b17df67bc4a327c56ecd20611f0' };
/**
 * 自己從 kha-white/manga-ocr-base 匯出的 KV cache decoder（#317、ADR 0014）：onnx-community 沒有帶 past 的版本。
 * cross_kv 把 encoder 輸出投影成 cross-attention 的 K/V（整頁一次），decoder_with_past 每步只算新的一個位置。2026-11-20 查 HF API。
 */
const OCR_KV = { repo: 'yurenju/manga-ocr-base-kv-onnx', revision: '449fcfd61f4446a0fb0cd9010e95c3fa927651f5' };

export const MODEL_FILES = {
  detector: {
    ...DETECTOR,
    path: 'detector-v4-s_int8.onnx',
    size: 11_120_765,
    sha256: '5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79',
  },
  encoderFp32: {
    ...OCR,
    path: 'onnx/encoder_model.onnx',
    size: 343_377_067,
    sha256: 'df35f64c2400ea860c70a2d06f2a1f99892374a78c89fcf35308076557a3863f',
  },
  crossKvFp32: {
    ...OCR_KV,
    path: 'onnx/cross_kv.onnx',
    size: 9_455_859,
    sha256: '37c72aa64717972146a7ae700a7664441c8bf572270b94328b088567dd294c6b',
  },
  decoderFp32: {
    ...OCR_KV,
    path: 'onnx/decoder_with_past.onnx',
    size: 107_922_894,
    sha256: '96a0759d48049f1e5cf7e2f224387c04a52fde6690509a8819c9d04be8a4c48f',
  },
  encoderQ8: {
    ...OCR,
    path: 'onnx/encoder_model_quantized.onnx',
    size: 86_967_767,
    sha256: 'ddd1af56963093795705fa38da6ce7e6567d1658e7c7359db7e13fcd37dbf279',
  },
  crossKvQ8: {
    ...OCR_KV,
    path: 'onnx/cross_kv_quantized.onnx',
    size: 2_383_397,
    sha256: 'a1eb279b6a3ee37b5ace456e8b7fbd67eecc764f1b78de52d05e5a08edc34f0e',
  },
  decoderQ8: {
    ...OCR_KV,
    path: 'onnx/decoder_with_past_quantized.onnx',
    size: 27_149_429,
    sha256: '0a0205e4a60991797f875782618a7f6e7191f39a6820813af40a2cc57000bcd3',
  },
  vocab: {
    repo: 'kha-white/manga-ocr-base',
    revision: 'aa6573bd10b0d446cbf622e29c3e084914df9741',
    path: 'vocab.txt',
    size: 24_072,
    sha256: '344fbb6b8bf18c57839e924e2c9365434697e0227fac00b88bb4899b78aa594d',
  },
} satisfies Record<string, ModelFile>;

export interface ModelSet {
  detector: ModelFile;
  encoder: ModelFile;
  crossKv: ModelFile;
  decoder: ModelFile;
  vocab: ModelFile;
}

/**
 * 依執行環境選模型（#7 的建議）：WebGPU 用 fp32 OCR（q8 在 WebGPU 上反而慢）、wasm 用 q8。
 * detector 兩邊都用 spec 指定的 detector-v4-s_int8。下載量：wasm 約 128 MB、WebGPU 約 472 MB。
 */
export const MODEL_SETS: Record<ExecutionProvider, ModelSet> = {
  webgpu: {
    detector: MODEL_FILES.detector,
    encoder: MODEL_FILES.encoderFp32,
    crossKv: MODEL_FILES.crossKvFp32,
    decoder: MODEL_FILES.decoderFp32,
    vocab: MODEL_FILES.vocab,
  },
  wasm: {
    detector: MODEL_FILES.detector,
    encoder: MODEL_FILES.encoderQ8,
    crossKv: MODEL_FILES.crossKvQ8,
    decoder: MODEL_FILES.decoderQ8,
    vocab: MODEL_FILES.vocab,
  },
};

/** 一組模型的五個檔案（下載與載入的順序）。 */
export const modelSetFiles = (set: ModelSet): ModelFile[] => [set.detector, set.encoder, set.crossKv, set.decoder, set.vocab];

/**
 * 任何一組會用到的檔案：Cache Storage 裡不在這裡面的是舊版留下的，可以清掉（#317）。
 * 兩組都留：WebGPU 建不起來時會退回 wasm，那組也可能已經下載過。
 */
export const ALL_MODEL_SET_FILES: readonly ModelFile[] = [...new Set(Object.values(MODEL_SETS).flatMap(modelSetFiles))];

/** 這組模型要下載的總 bytes（onboarding 第 1 步顯示「約 472 或 128 MB」）。 */
export const modelSetBytes = (set: ModelSet): number => filesBytes(modelSetFiles(set));

/** 這些檔案的總 bytes。 */
export const filesBytes = (files: readonly ModelFile[]): number => files.reduce((sum, file) => sum + file.size, 0);

/**
 * 有 WebGPU adapter 才用 WebGPU；headless 與部分 Mac 沒有，退回 wasm。翻譯流程、預先下載與 SW 判斷「已下載」都用它選同一組。
 * 只能在 document 裡呼叫：在 SW 裡 requestAdapter() 不會回應，SW 要問 offscreen（offscreen:detectExecutionProvider）。
 */
export async function detectExecutionProvider(): Promise<ExecutionProvider> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try {
    return (await gpu?.requestAdapter()) ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

export const HUGGING_FACE = 'https://huggingface.co';

export function modelUrl(file: ModelFile, baseUrl: string = HUGGING_FACE): string {
  return `${baseUrl}/${file.repo}/resolve/${file.revision}/${file.path}`;
}
