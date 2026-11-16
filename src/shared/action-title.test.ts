import { describe, expect, it } from 'vitest';
import { actionTitle, createActionTitleSync, iconClick } from './action-title.ts';

describe('點圖示會怎樣（ADR 0003）', () => {
  it('沒啟動：啟動', () => {
    expect(iconClick({ active: false, panelOnActivation: true, panelOpen: false })).toBe('start');
  });

  it('已啟動、側邊欄開著：停止', () => {
    expect(iconClick({ active: true, panelOnActivation: true, panelOpen: true })).toBe('stop');
  });

  it('已啟動、側邊欄被關掉：打開側邊欄', () => {
    expect(iconClick({ active: true, panelOnActivation: true, panelOpen: false })).toBe('openPanel');
  });

  it('不開側邊欄的讀者：已啟動就是停止', () => {
    expect(iconClick({ active: true, panelOnActivation: false, panelOpen: false })).toBe('stop');
  });
});

describe('圖示的 hover 提示說清楚點一下會怎樣（ADR 0003）', () => {
  it('沒在翻譯：名字、點一下翻譯、剩餘額度', () => {
    expect(actionTitle({ click: 'start', quotaLine: '本月剩 2,561 頁・12/11 重置' })).toBe(
      'Naruhodo 漫畫翻譯\n點一下翻譯這個分頁\n本月剩 2,561 頁・12/11 重置',
    );
  });

  it('翻譯中、側邊欄開著：點一下停止', () => {
    expect(actionTitle({ click: 'stop', quotaLine: '免費額度剩 42 頁' })).toBe('Naruhodo 漫畫翻譯・翻譯中\n點一下停止翻譯\n免費額度剩 42 頁');
  });

  it('翻譯中、側邊欄關著：點一下打開側邊欄', () => {
    expect(actionTitle({ click: 'openPanel', quotaLine: undefined })).toBe('Naruhodo 漫畫翻譯・翻譯中\n點一下打開側邊欄');
  });

  it('正在讀條漫（#282）：最後多一行計費方式', () => {
    expect(actionTitle({ click: 'stop', quotaLine: '免費額度剩 37 頁', strip: true })).toBe(
      'Naruhodo 漫畫翻譯・翻譯中\n點一下停止翻譯\n免費額度剩 37 頁\n條漫：每 8 句計 1 頁',
    );
  });
});

describe('hover 提示要設到哪裡', () => {
  function fakeAction() {
    const titles = new Map<number | 'global', string>();
    const sync = createActionTitleSync((title, tabId) => void titles.set(tabId ?? 'global', title));
    return { titles, sync };
  }

  it('額度變了：全域那份與每個設過的分頁都換新的額度', () => {
    const { titles, sync } = fakeAction();
    sync.tab(3, { click: 'openPanel', strip: true });

    sync.quota('免費額度剩 9 頁');

    expect(titles.get('global')).toBe('Naruhodo 漫畫翻譯\n點一下翻譯這個分頁\n免費額度剩 9 頁');
    expect(titles.get(3)).toBe('Naruhodo 漫畫翻譯・翻譯中\n點一下打開側邊欄\n免費額度剩 9 頁\n條漫：每 8 句計 1 頁');
  });

  it('停止翻譯、不是條漫的分頁跟全域那份一樣：設一次，之後不再一個個重設', () => {
    const { titles, sync } = fakeAction();
    sync.tab(3, { click: 'stop', strip: false });
    sync.tab(3, { click: 'start', strip: false });
    expect(titles.get(3)).toBe('Naruhodo 漫畫翻譯\n點一下翻譯這個分頁');
    titles.clear();

    sync.quota(undefined);

    expect([...titles.keys()]).toEqual(['global']);
  });

  it('分頁關掉後額度再變，就不再設它', () => {
    const { titles, sync } = fakeAction();
    sync.tab(3, { click: 'stop', strip: false });
    sync.forget(3);
    titles.clear();

    sync.quota(undefined);

    expect([...titles.keys()]).toEqual(['global']);
  });
});
