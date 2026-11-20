/**
 * SW 回答「目前的模型狀態」（#169）。SW 記在記憶體裡的狀態，在 SW 被回收或模型釋放後是 idle（不知道）；
 * 這時查 Cache Storage 裡會用的那一組模型齊不齊全，齊全就是 downloaded（已下載、還沒載入）。
 */
import { filesBytes, MODEL_SETS, modelSetFiles, type ModelFile, type ModelSet } from '../offscreen/models/model-files.ts';
import type { ExecutionProvider, ModelStatus, ModelStatusResponse } from '../shared/messages.ts';

export async function currentModelStatus(known: ModelStatus, isCached: () => Promise<boolean>): Promise<ModelStatus> {
  if (known.state !== 'idle') return known;
  return (await isCached()) ? { state: 'downloaded' } : known;
}

export interface ModelStatusDeps {
  /** 這台電腦用哪一組模型；offscreen 還沒準備好時會失敗（#221）。 */
  executionProvider: () => Promise<ExecutionProvider>;
  /** 這些檔案裡還不在快取裡的。 */
  missingFiles: (files: readonly ModelFile[]) => Promise<ModelFile[]>;
}

/**
 * 回答 panel:getModelStatus：不知道時查快取裡會用的那一組（照翻譯流程的選法）齊不齊全；也帶上還要下載多少。
 * 只算還缺的檔案（#317）：外掛更新換了 decoder 時，已經下載過的讀者只要補那幾個檔案。
 * 問不到用哪一組時不能斷掉 side panel 的請求：回目前知道的狀態、不帶大小，之後 offscreen 的 models:status 廣播會更新它。
 */
export async function modelStatusResponse(known: ModelStatus, deps: ModelStatusDeps): Promise<ModelStatusResponse> {
  let set: ModelSet;
  try {
    set = MODEL_SETS[await deps.executionProvider()];
  } catch (e) {
    console.warn('model status: execution provider unknown', e);
    return { status: known };
  }
  const missing = await deps.missingFiles(modelSetFiles(set));
  return { status: await currentModelStatus(known, async () => missing.length === 0), downloadBytes: filesBytes(missing) };
}

/**
 * 外掛更新（onInstalled 的 reason 是 update）後要不要在背景補下載（#317）：更新換了模型檔（例如 KV cache decoder），而讀者先前已經下載過這一組
 * （快取裡有一部分）時，就先把缺的補齊，免得更新後第一次翻頁要等一百多 MB。先前已經同意過下載模型，所以不再問；
 * 從沒下載過的讀者照舊等 onboarding 或第一次翻譯。
 */
export function shouldRefreshModelsAfterUpdate({ missing, total }: { missing: number; total: number }): boolean {
  return missing > 0 && missing < total;
}
