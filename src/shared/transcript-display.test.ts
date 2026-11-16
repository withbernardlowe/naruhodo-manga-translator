import { describe, expect, it } from 'vitest';
import { displaySummary, parseTranscriptDisplay } from './transcript-display.ts';

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
