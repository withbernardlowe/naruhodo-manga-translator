import { describe, expect, it } from 'vitest';
import { parseDisplaySettings } from './display-settings.ts';

describe('parseDisplaySettings：⚙ 設定頁「顯示」的兩個開關', () => {
  it('沒存過：都關（學習模式照舊先藏譯文、不顯示羅馬拼音）', () => {
    expect(parseDisplaySettings(undefined)).toEqual({ learnShowsTranslation: false, romaji: false });
  });

  it('存過的值照舊', () => {
    expect(parseDisplaySettings({ learnShowsTranslation: true, romaji: true })).toEqual({ learnShowsTranslation: true, romaji: true });
  });

  it('壞掉的欄位各自退回預設，另一個欄位照舊', () => {
    expect(parseDisplaySettings({ learnShowsTranslation: 'yes', romaji: true })).toEqual({ learnShowsTranslation: false, romaji: true });
    expect(parseDisplaySettings(true)).toEqual({ learnShowsTranslation: false, romaji: false });
  });
});
