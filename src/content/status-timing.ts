/**
 * 全站狀態面板（status-panel.ts）什麼時候出現、什麼時候收起：SW 每送來一份內容，決定這一步要怎麼做。
 * - 處理中要過一下（SHOW_DELAY_MS）還在忙才出現：命中快取的頁幾十 ms 就好，不先閃一下「排隊中」。
 * - 這一批處理完的摘要（翻譯完成、套用快取）停 SETTLED_MS 才淡出；同一批重送不重新計時，收起了就不再出現。
 * - 有要讀者處理的馬上出現。
 * 計時器與 hover 在 status-panel.ts，這裡只有規則。
 */
import type { StatusPanel } from '../shared/page-status.ts';

/** 處理中的面板過這麼久（ms）還在忙才出現。 */
export const SHOW_DELAY_MS = 400;

/** 這一批處理完的摘要停這麼久（ms）才淡出（滑鼠在上面時不算）。 */
export const SETTLED_MS = 2000;

export interface PanelTiming {
  /** 畫面上的是哪一種面板；undefined＝沒有。 */
  showing: StatusPanel['header']['kind'] | undefined;
  /** 正在淡出。 */
  fading: boolean;
  /** 這一批的摘要已經出現過（停留中或已經收起）。 */
  settledShown: boolean;
}

export type PanelStep =
  /** 畫出這一份；linger：摘要開始計時，時間到就收起。 */
  | { do: 'show'; linger: boolean }
  /** 先不畫：SHOW_DELAY_MS 後還在忙才畫最新的那一份。 */
  | { do: 'delay' }
  | { do: 'hide' }
  /** 什麼都不做。 */
  | { do: 'keep' };

export function nextStep({ showing, fading, settledShown }: PanelTiming, panel: StatusPanel | undefined): PanelStep {
  if (!panel) return { do: 'hide' };
  if (panel.header.kind === 'settled') {
    if (!settledShown) return { do: 'show', linger: true };
    return showing === 'settled' && !fading ? { do: 'show', linger: false } : { do: 'keep' };
  }
  // 摘要還在時也先等：接著命中快取的話，摘要直接換成下一份摘要
  if (panel.expanded || (showing !== undefined && showing !== 'settled')) return { do: 'show', linger: false };
  return { do: 'delay' };
}
