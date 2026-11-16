/**
 * 頁面上 hover 一句時，除了藍框還出什麼（U10）。側邊欄開著時，tooltip 的內容跟側邊欄高亮那行一模一樣，
 * 閱讀模式就只標一個跟側邊欄同號的編號，不蓋住旁邊的畫。學習模式保留 tooltip：讀者的視線在頁面的日文上，
 * 讀音、譯文的逐步揭露就在 tooltip 裡做。側邊欄關著時沒有東西可對，不標編號。
 */
import type { PageMode } from '../shared/page-mode.ts';

export interface HoverAid {
  tooltip: boolean;
  /** 高亮框標上跟側邊欄同號的編號。 */
  orderBadge: boolean;
}

export const hoverAid = ({ pageMode, panelOpen }: { pageMode: PageMode; panelOpen: boolean }): HoverAid => ({
  tooltip: pageMode === 'learn' || !panelOpen,
  orderBadge: panelOpen,
});
