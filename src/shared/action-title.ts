/**
 * 圖示的 hover 提示（ADR 0003）：說清楚點一下會怎樣，加上剩餘頁數（#237）與條漫的計費方式（#282）。
 * 點一下會怎樣（iconClick）也是 background/activation.ts 的 toggle 用的規則。
 * 提示用 chrome.action.setTitle 設，存在瀏覽器裡：SW 休息時也不會變錯，狀態一變（啟動、停止、側邊欄開關）SW 就被叫醒重設。
 */
import { STRIP_LINES_PER_PAGE } from './hosted-api.ts';

export const ACTION_NAME = 'Naruhodo 漫畫翻譯';

/** 點一下圖示會：啟動／停止／打開被讀者關掉的側邊欄。 */
export type IconClick = 'start' | 'stop' | 'openPanel';

const CLICK_HINTS: Record<IconClick, string> = {
  start: '點一下翻譯這個分頁',
  stop: '點一下停止翻譯',
  openPanel: '點一下打開側邊欄',
};

/** panelOnActivation：Side Panel on Activation；關著的讀者不用側邊欄，已啟動時點一下就停止。 */
export function iconClick(s: { active: boolean; panelOnActivation: boolean; panelOpen: boolean }): IconClick {
  if (!s.active) return 'start';
  return s.panelOnActivation && !s.panelOpen ? 'openPanel' : 'stop';
}

/**
 * 最後一行（#326）：讓沒想過要按右鍵的讀者知道選單裡有東西。「選項」是 Chrome 看到 options_ui 自己加的那一項（設定頁），
 * 閱讀／學習是我們的（shared/action-menu.ts）。
 */
const MENU_HINT = '右鍵：選項、閱讀／學習';

/** quotaLine：剩餘頁數那行（shared/quota-indicator.ts）；自備金鑰或沒登入時沒有。strip：正在讀照句數計頁的條漫。 */
export function actionTitle({ click, quotaLine, strip = false }: { click: IconClick; quotaLine: string | undefined; strip?: boolean }): string {
  const name = click === 'start' ? ACTION_NAME : `${ACTION_NAME}・翻譯中`;
  const stripLine = strip ? `條漫：每 ${STRIP_LINES_PER_PAGE} 句計 1 頁` : undefined;
  return [name, CLICK_HINTS[click], quotaLine, stripLine, MENU_HINT].filter((line) => line !== undefined).join('\n');
}

interface TabTitle {
  click: IconClick;
  strip: boolean;
}

/**
 * 全域那份（沒在翻譯的分頁）加上跟它不一樣的分頁（翻譯中、條漫）。分頁專屬的不會跟著全域變，所以額度變了要一個個重設。
 * 停止了、不是條漫的分頁跟全域那份一樣，不記（關掉的分頁也就不會留著）。setTitle 沒帶 tabId 是全域那份。
 */
export function createActionTitleSync(setTitle: (title: string, tabId?: number) => void) {
  let quotaLine: string | undefined;
  const tabs = new Map<number, TabTitle>();
  const show = (tabId: number, t: TabTitle) => setTitle(actionTitle({ ...t, quotaLine }), tabId);

  return {
    quota(line: string | undefined): void {
      quotaLine = line;
      setTitle(actionTitle({ click: 'start', quotaLine }));
      for (const [tabId, t] of tabs) show(tabId, t);
    },
    /** 每次都給完整的狀態：SW 休息後記憶體是空的，只給一部分會把另一部分當成預設值。 */
    tab(tabId: number, t: TabTitle): void {
      if (t.click === 'start' && !t.strip) tabs.delete(tabId);
      else tabs.set(tabId, t);
      show(tabId, t);
    },
    forget(tabId: number): void {
      tabs.delete(tabId);
    },
  };
}
