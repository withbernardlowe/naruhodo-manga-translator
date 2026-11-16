import { describe, expect, it } from 'vitest';
import { hoverAid } from './hover-aid.ts';

describe('hoverAid：頁面 hover 時出 tooltip 還是只標編號（U10）', () => {
  it('閱讀、側邊欄開著：只標編號，原文讀音譯文都在側邊欄高亮那行', () => {
    expect(hoverAid({ pageMode: 'read', panelOpen: true })).toEqual({ tooltip: false, orderBadge: true });
  });

  it('閱讀、側邊欄關著：完整 tooltip，沒有編號可對', () => {
    expect(hoverAid({ pageMode: 'read', panelOpen: false })).toEqual({ tooltip: true, orderBadge: false });
  });

  it('學習、側邊欄開著：保留 tooltip（逐步揭露在這裡做），加上編號', () => {
    expect(hoverAid({ pageMode: 'learn', panelOpen: true })).toEqual({ tooltip: true, orderBadge: true });
  });

  it('學習、側邊欄關著：只有 tooltip', () => {
    expect(hoverAid({ pageMode: 'learn', panelOpen: false })).toEqual({ tooltip: true, orderBadge: false });
  });
});
