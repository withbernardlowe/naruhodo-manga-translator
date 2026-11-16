/**
 * 條漫（Strip，#282）計頁說明看過了沒（U14）。規則跟作品無關，讀者懂一次就夠：按「知道了」之後任何條漫都不再出現，
 * 只留逐字稿最下面「本話已計 N 頁」那行。
 */
import { watchLocal } from './watch-local.ts';

const KEY = 'stripNoticeSeen';

export function dismissStripNotice(): Promise<void> {
  return chrome.storage.local.set({ [KEY]: true });
}

export const watchStripNoticeSeen = (onChange: (seen: boolean) => void) => watchLocal(KEY, (value) => value === true, onChange);
