/**
 * 圖示的右鍵選單（#326）：帳號與訂閱（#213，快用完時帶剩餘頁數，#237）、Page Mode 的閱讀／學習、Romaji。
 * 不開側邊欄的讀者不必打開設定就能切；設定頁（settings.html）由 Chrome 看到 options_ui 自己加的「選項」打開，這裡不另外加。
 * 「學習模式直接顯示譯文」只在學習模式有作用，不放進選單。
 * 勾選狀態跟著 chrome.storage 走：SW 每次啟動照目前的值建，設定在別處改了就用 actionMenuChecks 更新。
 */
import type { PageMode } from './page-mode.ts';

/** 「帳號與訂閱」那項的 id：額度變了只改它的文字。 */
export const ACCOUNT_MENU_ID = 'account';
const SEPARATOR = 'separator';
const READ = 'pageMode:read';
const LEARN = 'pageMode:learn';
const ROMAJI = 'romaji';

export interface ActionMenuState {
  pageMode: PageMode;
  romaji: boolean;
}

/** accountTitle：「帳號與訂閱」那項的文字（shared/quota-indicator.ts 的 menuTitle）。 */
export function actionMenuItems(accountTitle: string, state: ActionMenuState): chrome.contextMenus.CreateProperties[] {
  const checks = new Map(actionMenuChecks(state).map(({ id, checked }) => [id, checked]));
  return [
    { id: ACCOUNT_MENU_ID, type: 'normal', title: accountTitle, contexts: ['action'] },
    { id: SEPARATOR, type: 'separator', contexts: ['action'] },
    { id: READ, type: 'radio', title: '閱讀', checked: checks.get(READ), contexts: ['action'] },
    { id: LEARN, type: 'radio', title: '學習', checked: checks.get(LEARN), contexts: ['action'] },
    { id: ROMAJI, type: 'checkbox', title: '讀音加上羅馬拼音', checked: checks.get(ROMAJI), contexts: ['action'] },
  ];
}

/** 每個可勾選項目現在該不該勾。 */
export function actionMenuChecks({ pageMode, romaji }: ActionMenuState): { id: string; checked: boolean }[] {
  return [
    { id: READ, checked: pageMode === 'read' },
    { id: LEARN, checked: pageMode === 'learn' },
    { id: ROMAJI, checked: romaji },
  ];
}

export type ActionMenuChoice = { kind: 'account' } | { kind: 'pageMode'; mode: PageMode } | { kind: 'romaji'; on: boolean };

/** contextMenus.onClicked 的那一項要改什麼；checked 是 Chrome 點完之後的勾選狀態。不是我們的項目是 undefined。 */
export function actionMenuChoice({ menuItemId, checked }: { menuItemId: string | number; checked?: boolean }): ActionMenuChoice | undefined {
  switch (menuItemId) {
    case ACCOUNT_MENU_ID:
      return { kind: 'account' };
    case READ:
      return { kind: 'pageMode', mode: 'read' };
    case LEARN:
      return { kind: 'pageMode', mode: 'learn' };
    case ROMAJI:
      return { kind: 'romaji', on: checked === true };
    default:
      return undefined;
  }
}
