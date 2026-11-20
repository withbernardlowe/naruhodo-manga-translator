import { describe, expect, it, vi } from 'vitest';
import { MODEL_SETS, modelSetBytes } from '../offscreen/models/model-files.ts';
import type { ModelStatus } from '../shared/messages.ts';
import { currentModelStatus, modelStatusResponse, refreshModelsAfterUpdate } from './model-status.ts';

describe('SW 回答目前的模型狀態（#169）', () => {
  it('不知道（SW 剛啟動、或模型已釋放）而那一組模型都在快取裡：downloaded', async () => {
    expect(await currentModelStatus({ state: 'idle' }, async () => true)).toEqual({ state: 'downloaded' });
  });

  it('不知道而快取裡不齊全：idle', async () => {
    expect(await currentModelStatus({ state: 'idle' }, async () => false)).toEqual({ state: 'idle' });
  });

  it('知道的狀態照實回答，不查快取', async () => {
    const isCached = vi.fn(async () => true);
    const known: ModelStatus[] = [
      { state: 'downloading', loaded: 1, total: 2 },
      { state: 'downloaded' },
      { state: 'loading' },
      { state: 'ready', executionProvider: 'wasm', threads: 2 },
      { state: 'error', message: '下載失敗' },
    ];
    for (const status of known) expect(await currentModelStatus(status, isCached)).toEqual(status);
    expect(isCached).not.toHaveBeenCalled();
  });
});

describe('side panel、onboarding 問模型狀態（#221）', () => {
  it('問不到這台電腦用哪一組模型：不丟錯，回目前知道的狀態、不帶下載大小', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await modelStatusResponse(
      { state: 'idle' },
      { executionProvider: async () => Promise.reject(new Error('offscreen 還沒準備好')), missingFiles: async () => [] },
    );
    expect(response).toEqual({ status: { state: 'idle' } });
  });

  it('問得到、那一組都在快取裡：downloaded，不用再下載', async () => {
    const response = await modelStatusResponse({ state: 'idle' }, { executionProvider: async () => 'wasm', missingFiles: async () => [] });
    expect(response).toEqual({ status: { state: 'downloaded' }, downloadBytes: 0 });
  });

  it('什麼都還沒下載：要下載整組', async () => {
    const response = await modelStatusResponse({ state: 'idle' }, { executionProvider: async () => 'wasm', missingFiles: async (files) => [...files] });
    expect(response).toEqual({ status: { state: 'idle' }, downloadBytes: modelSetBytes(MODEL_SETS.wasm) });
  });

  it('只缺換過的檔案（外掛更新換了 decoder，#317）：只算還缺的大小', async () => {
    const { crossKv, decoder } = MODEL_SETS.webgpu;
    const response = await modelStatusResponse(
      { state: 'idle' },
      { executionProvider: async () => 'webgpu', missingFiles: async (files) => files.filter((f) => f === crossKv || f === decoder) },
    );
    expect(response).toEqual({ status: { state: 'idle' }, downloadBytes: crossKv.size + decoder.size });
  });
});

describe('外掛更新後在背景補下載換過的模型（#317）', () => {
  it('已經下載過（快取裡有這一組的部分檔案）、只缺換過的：補下載', () => {
    expect(refreshModelsAfterUpdate('update', { missing: 2, total: 5 })).toBe(true);
  });

  it('從沒下載過：不下載（還沒同意過，等 onboarding 或第一次翻譯）', () => {
    expect(refreshModelsAfterUpdate('update', { missing: 5, total: 5 })).toBe(false);
  });

  it('都在快取裡：不用下載', () => {
    expect(refreshModelsAfterUpdate('update', { missing: 0, total: 5 })).toBe(false);
  });

  it('全新安裝不在這裡下載（onboarding 按「開始設定」才下載）', () => {
    expect(refreshModelsAfterUpdate('install', { missing: 5, total: 5 })).toBe(false);
    expect(refreshModelsAfterUpdate('chrome_update', { missing: 2, total: 5 })).toBe(false);
  });
});
