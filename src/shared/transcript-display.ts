/**
 * 逐字稿要顯示什麼（GLOSSARY 的 Display Level）：閱讀時三個層級；學習時只有振り仮名開關，
 * 譯文藏在「譯」區塊後面（⚙ 開了「學習模式直接顯示譯文」就不藏，lineDisplay）。
 * 只改 side panel 的逐字稿，頁面不變（頁面跟著 Page Mode）。跟 Page Mode 一樣存在 chrome.storage.local：
 * 所有分頁共用、重開 side panel 也記得（U15）。
 */
import { hidesTranslation, type DisplaySettings } from './display-settings.ts';
import type { PageMode } from './page-mode.ts';
import { watchLocal } from './watch-local.ts';

/** 閱讀時的 Display Level：整頁一起切。存的是 key，畫面上的字（LEVEL_LABELS）改了，讀者存的設定也不會失效。 */
export const LEVELS = ['translationOnly', 'withOriginal', 'withReading'] as const;
export type DisplayLevel = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<DisplayLevel, string> = {
  translationOnly: '只看譯文',
  withOriginal: '原文＋譯文',
  withReading: '加上讀音',
};

/** 存下來的選擇：兩個模式各自的設定都記著，切模式不會弄丟另一邊的。 */
export interface TranscriptDisplay {
  level: DisplayLevel;
  furigana: boolean;
}

export const DEFAULT_TRANSCRIPT_DISPLAY: TranscriptDisplay = { level: 'withReading', furigana: true };

/** 這一刻逐字稿的顯示方式：依 Page Mode 取存下來的其中一個設定。 */
export type Display = { mode: 'read'; level: DisplayLevel } | { mode: 'learn'; furigana: boolean };

export const currentDisplay = (pageMode: PageMode, saved: TranscriptDisplay): Display =>
  pageMode === 'learn' ? { mode: 'learn', furigana: saved.furigana } : { mode: 'read', level: saved.level };

/** 逐字稿每一句顯示哪些部分：ルビ、羅馬拼音、只看譯文（藏原文）、譯文藏在「譯」後面。 */
export interface LineDisplay {
  ruby: boolean;
  romaji: boolean;
  translationOnly: boolean;
  hideTranslation: boolean;
}

/** 逐字稿選單的選擇＋⚙ 的顯示設定 → 每一句怎麼畫。羅馬拼音跟著讀音走（GLOSSARY 的 Romaji）。 */
export function lineDisplay(display: Display, settings: DisplaySettings): LineDisplay {
  const ruby = display.mode === 'learn' ? display.furigana : display.level === 'withReading';
  return {
    ruby,
    romaji: ruby && settings.romaji,
    translationOnly: display.mode === 'read' && display.level === 'translationOnly',
    hideTranslation: hidesTranslation(display.mode, settings),
  };
}

const KEY = 'transcriptDisplay';

/** 每個欄位各自檢查：壞掉的欄位退回預設，另一個照舊。 */
export function parseTranscriptDisplay(value: unknown): TranscriptDisplay {
  const stored = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const level = LEVELS.find((l) => l === stored.level) ?? DEFAULT_TRANSCRIPT_DISPLAY.level;
  const furigana = typeof stored.furigana === 'boolean' ? stored.furigana : DEFAULT_TRANSCRIPT_DISPLAY.furigana;
  return { level, furigana };
}

export function saveTranscriptDisplay(display: TranscriptDisplay): Promise<void> {
  return chrome.storage.local.set({ [KEY]: display });
}

/** 先讀一次目前的值，之後每次變更都呼叫 onChange；回傳取消監聽。 */
export const watchTranscriptDisplay = (onChange: (display: TranscriptDisplay) => void) => watchLocal(KEY, parseTranscriptDisplay, onChange);

/** 逐字稿顯示選單按鈕上的字：關著選單也看得到現在是哪一種。 */
export const displaySummary = (display: Display): string =>
  display.mode === 'read' ? LEVEL_LABELS[display.level] : `讀音：${display.furigana ? '開' : '關'}`;
