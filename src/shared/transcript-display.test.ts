import { describe, expect, it } from 'vitest';
import { displaySummary, lineDisplay, parseTranscriptDisplay } from './transcript-display.ts';

const off = { learnShowsTranslation: false, romaji: false };
const on = { learnShowsTranslation: true, romaji: true };

describe('lineDisplay：逐字稿每一句顯示哪些部分', () => {
  it('預設（⚙ 兩個開關都關）跟以前一樣：學習藏譯文、閱讀直接顯示，都沒有羅馬拼音', () => {
    expect(lineDisplay({ mode: 'learn', furigana: true }, off)).toEqual({ ruby: true, romaji: false, translationOnly: false, hideTranslation: true });
    expect(lineDisplay({ mode: 'read', level: 'withReading' }, off)).toEqual({ ruby: true, romaji: false, translationOnly: false, hideTranslation: false });
  });

  it('學習模式直接顯示譯文：不藏在「譯」後面；閱讀本來就不藏', () => {
    expect(lineDisplay({ mode: 'learn', furigana: true }, { ...off, learnShowsTranslation: true }).hideTranslation).toBe(false);
    expect(lineDisplay({ mode: 'read', level: 'withOriginal' }, { ...off, learnShowsTranslation: true }).hideTranslation).toBe(false);
  });

  it('羅馬拼音跟著讀音走：讀音沒顯示時也不顯示', () => {
    expect(lineDisplay({ mode: 'learn', furigana: true }, on).romaji).toBe(true);
    expect(lineDisplay({ mode: 'learn', furigana: false }, on).romaji).toBe(false);
    expect(lineDisplay({ mode: 'read', level: 'withReading' }, on).romaji).toBe(true);
    expect(lineDisplay({ mode: 'read', level: 'withOriginal' }, on).romaji).toBe(false);
    expect(lineDisplay({ mode: 'read', level: 'translationOnly' }, on)).toEqual({ ruby: false, romaji: false, translationOnly: true, hideTranslation: false });
  });
});

describe('parseTranscriptDisplay', () => {
  it('沒存過：加上讀音、讀音開', () => {
    expect(parseTranscriptDisplay(undefined)).toEqual({ level: 'withReading', furigana: true });
  });

  it('存過的值照舊', () => {
    expect(parseTranscriptDisplay({ level: 'translationOnly', furigana: false })).toEqual({ level: 'translationOnly', furigana: false });
  });

  it('壞掉的欄位各自退回預設，另一個欄位照舊', () => {
    expect(parseTranscriptDisplay({ level: '只看譯文', furigana: false })).toEqual({ level: 'withReading', furigana: false });
    expect(parseTranscriptDisplay({ level: 'withOriginal', furigana: 'yes' })).toEqual({ level: 'withOriginal', furigana: true });
    expect(parseTranscriptDisplay('withReading')).toEqual({ level: 'withReading', furigana: true });
  });
});

describe('displaySummary：逐字稿顯示選單按鈕上的字', () => {
  it('閱讀時是目前層級的名稱', () => {
    expect(displaySummary({ mode: 'read', level: 'withOriginal' })).toBe('原文＋譯文');
    expect(displaySummary({ mode: 'read', level: 'translationOnly' })).toBe('只看譯文');
  });

  it('學習時是讀音開或關', () => {
    expect(displaySummary({ mode: 'learn', furigana: true })).toBe('讀音：開');
    expect(displaySummary({ mode: 'learn', furigana: false })).toBe('讀音：關');
  });
});
