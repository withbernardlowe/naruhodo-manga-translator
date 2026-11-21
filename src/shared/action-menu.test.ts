import { describe, expect, it } from 'vitest';
import { actionMenuChecks, actionMenuChoice, actionMenuItems } from './action-menu.ts';

describe('圖示的右鍵選單（#326）', () => {
  it('帳號與訂閱、分隔線、閱讀／學習兩個單選、羅馬拼音的勾選；只在圖示上', () => {
    const items = actionMenuItems('帳號與訂閱・剩 5 頁', { pageMode: 'learn', romaji: true });

    expect(items.map(({ type, title, checked }) => ({ type, title, checked }))).toEqual([
      { type: 'normal', title: '帳號與訂閱・剩 5 頁', checked: undefined },
      { type: 'separator', title: undefined, checked: undefined },
      { type: 'radio', title: '閱讀', checked: false },
      { type: 'radio', title: '學習', checked: true },
      { type: 'checkbox', title: '讀音加上羅馬拼音', checked: true },
    ]);
    expect(items.every((item) => item.contexts?.join() === 'action')).toBe(true);
    // Chrome 對頂層項目有上限（6 項）
    expect(items.filter((item) => item.type !== 'separator').length).toBeLessThanOrEqual(6);
  });

  it('設定在別處改了：勾選跟著目前的 Page Mode 與 Romaji', () => {
    const items = actionMenuItems('帳號與訂閱', { pageMode: 'read', romaji: false });
    const id = (title: string) => items.find((item) => item.title === title)!.id;

    expect(actionMenuChecks({ pageMode: 'read', romaji: false })).toEqual([
      { id: id('閱讀'), checked: true },
      { id: id('學習'), checked: false },
      { id: id('讀音加上羅馬拼音'), checked: false },
    ]);
    expect(actionMenuChecks({ pageMode: 'learn', romaji: true })).toEqual([
      { id: id('閱讀'), checked: false },
      { id: id('學習'), checked: true },
      { id: id('讀音加上羅馬拼音'), checked: true },
    ]);
  });

  it('點了哪一項就改哪個設定；羅馬拼音照 Chrome 點完的勾選狀態', () => {
    const items = actionMenuItems('帳號與訂閱', { pageMode: 'read', romaji: false });
    const id = (title: string) => items.find((item) => item.title?.startsWith(title))!.id!;

    expect(actionMenuChoice({ menuItemId: id('帳號與訂閱') })).toEqual({ kind: 'account' });
    expect(actionMenuChoice({ menuItemId: id('學習'), checked: true })).toEqual({ kind: 'pageMode', mode: 'learn' });
    expect(actionMenuChoice({ menuItemId: id('閱讀'), checked: true })).toEqual({ kind: 'pageMode', mode: 'read' });
    expect(actionMenuChoice({ menuItemId: id('讀音加上羅馬拼音'), checked: true })).toEqual({ kind: 'romaji', on: true });
    expect(actionMenuChoice({ menuItemId: id('讀音加上羅馬拼音'), checked: false })).toEqual({ kind: 'romaji', on: false });
    expect(actionMenuChoice({ menuItemId: 'something-else' })).toBeUndefined();
  });
});
