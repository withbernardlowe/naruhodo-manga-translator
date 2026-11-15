import { acquireTestLock } from '../scripts/test-lock.ts';
import { ensureModelCache } from './model-cache.ts';

/**
 * 跑 e2e 前先備好模型（第一次約 128 MB，之後直接用 repo 外的快取）。
 * 另一輪 Playwright 測試還在跑時先排隊（scripts/test-lock.ts）；回傳的函式在測試結束時放掉鎖。
 */
export default async function globalSetup(): Promise<() => void> {
  const release = await acquireTestLock();
  try {
    await ensureModelCache();
    return release;
  } catch (e) {
    release();
    throw e;
  }
}
