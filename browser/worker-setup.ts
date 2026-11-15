import { acquireTestLock } from '../scripts/test-lock.ts';
import { startWorker } from './worker.ts';

/**
 * browser test 整輪只啟動一次本機 Worker（spec #86）：`wrangler dev --env test`，本機 D1、Anthropic 是 FakeTranslator。
 * 外掛與 Worker 之間的契約只有這一層測得到，所以不在 Playwright 裡攔網路。回傳的函式在測試結束時關掉它。
 * 另一輪 Playwright 測試還在跑時先排隊（scripts/test-lock.ts）。
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const release = await acquireTestLock();
  try {
    const stop = await startWorker({ env: 'test' });
    return async () => {
      await stop();
      release();
    };
  } catch (e) {
    release();
    throw e;
  }
}
