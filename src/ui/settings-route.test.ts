import { describe, expect, it } from 'vitest';
import { SETTINGS_CATEGORIES, settingsHash, settingsRoute } from './settings-route.ts';

describe('設定頁的分類（#326）', () => {
  it('三類照讀者想做的事排，每一類有一行副標寫出裡面有什麼', () => {
    expect(SETTINGS_CATEGORIES.map(({ label, sub }) => `${label}：${sub}`)).toEqual([
      '翻譯與帳號：翻譯方式、帳號、方案與額度',
      '閱讀與顯示：閱讀／學習、羅馬拼音、側邊欄',
      '資料與回饋：匯出匯入、回報問題',
    ]);
  });

  it('每一類有自己的 hash；帳號與訂閱是翻譯與帳號底下的子畫面', () => {
    expect(settingsRoute('#translation')).toEqual({ category: 'translation', account: false });
    expect(settingsRoute('#account')).toEqual({ category: 'translation', account: true });
    expect(settingsRoute('#display')).toEqual({ category: 'display', account: false });
    expect(settingsRoute('#data')).toEqual({ category: 'data', account: false });
  });

  it('沒有 hash（Chrome 的「選項」）或認不得的：開翻譯與帳號', () => {
    expect(settingsRoute('')).toEqual({ category: 'translation', account: false });
    expect(settingsRoute('#nope')).toEqual({ category: 'translation', account: false });
  });

  it('切換分類或進出帳號與訂閱時寫回網址的 hash，重新整理還是同一個畫面', () => {
    for (const hash of ['#translation', '#account', '#display', '#data']) expect(settingsHash(settingsRoute(hash))).toBe(hash);
  });
});
