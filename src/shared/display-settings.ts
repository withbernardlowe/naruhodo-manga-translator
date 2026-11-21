/**
 * ⚙ 設定頁「顯示」的兩個開關（GLOSSARY 的 Page Mode 與 Romaji）：
 * 學習模式直接顯示譯文（tooltip 與逐字稿不藏在「譯」後面），以及讀音加上羅馬拼音。
 * 跟 Page Mode 一樣存在 chrome.storage.local，所有分頁共用；content script 與 side panel 都聽它。
 */
import type { PageMode } from './page-mode.ts';
import { watchLocal } from './watch-local.ts';

export interface DisplaySettings {
  learnShowsTranslation: boolean;
  romaji: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = { learnShowsTranslation: false, romaji: false };

/** 譯文要不要藏在「譯」後面：只有學習模式、而且沒開「學習模式直接顯示譯文」時才藏。tooltip 與逐字稿共用。 */
export const hidesTranslation = (pageMode: PageMode, settings: DisplaySettings): boolean => pageMode === 'learn' && !settings.learnShowsTranslation;

const KEY = 'displaySettings';

/** 每個欄位各自檢查：壞掉的欄位退回預設，另一個照舊。 */
export function parseDisplaySettings(value: unknown): DisplaySettings {
  const stored = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const flag = (key: keyof DisplaySettings) => (typeof stored[key] === 'boolean' ? stored[key] : DEFAULT_DISPLAY_SETTINGS[key]);
  return { learnShowsTranslation: flag('learnShowsTranslation'), romaji: flag('romaji') };
}

export function saveDisplaySettings(settings: DisplaySettings): Promise<void> {
  return chrome.storage.local.set({ [KEY]: settings });
}

export async function loadDisplaySettings(): Promise<DisplaySettings> {
  return parseDisplaySettings((await chrome.storage.local.get(KEY))[KEY]);
}

/** 先讀一次目前的值，之後每次變更都呼叫 onChange；回傳取消監聽。 */
export const watchDisplaySettings = (onChange: (settings: DisplaySettings) => void) => watchLocal(KEY, parseDisplaySettings, onChange);
