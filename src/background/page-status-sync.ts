/**
 * 把每個 tab 的全站狀態（shared/page-status.ts）送到 content script、設成圖示 badge（#185）。
 * 依據：transcriber 每次 publish 的 PageView、工作開始本機流水線與送出 LLM 的事件、offscreen 廣播的模型狀態、額度快用完了沒（#237）。
 * 內容沒變就不重送（模型下載進度、每次擷取都會觸發）。
 */
import type { ModelStatus, PageView } from '../shared/messages.ts';
import { pageStatus, untranslatedWithoutReason, type ActionBadge, type PageStatusInput, type StatusPanel } from '../shared/page-status.ts';
import type { JobEvent } from './transcribe.ts';

export interface PageStatusSyncDeps {
  /** undefined＝沒在忙也沒出問題，收起面板。 */
  send(tabId: number, panel: StatusPanel | undefined): void;
  /** undefined＝沒啟動，拿掉 badge。 */
  setBadge(tabId: number, badge: ActionBadge | undefined): void;
  /** 現在不能翻譯的原因；只在有 Page 沒翻譯、也沒有別的原因時才問。 */
  accessProblem(): Promise<PageStatusInput['access']>;
  /** 現在是不是用內建翻譯、已登入（Strip 才會照句數計頁，#282）；只在 tab 正在讀 Strip 時才問。 */
  stripBilled(): Promise<boolean>;
  /** 這個 tab 開始／不再是照句數計頁的 Strip：圖示的 hover 提示多／少一行。 */
  setStrip(tabId: number, strip: boolean): void;
  /** 這個 tab 啟動著沒（存在 storage）：SW 重新啟動後記憶體是空的，靠它接回已啟動的 tab。 */
  isActive(tabId: number): Promise<boolean>;
}

interface TabStatus {
  pages: PageView[];
  /** 畫面上的這一串是 Strip（條漫，#282）。 */
  strip: boolean;
  /** 上次告訴 SW 的：這個 tab 是不是照句數計頁的 Strip。 */
  stripShown: boolean;
  /** 正在跑本機流水線的工作 → 它的 Page。照工作記：長 Page 的兩截是同一個 Page，可能一截在翻、下一截在辨識。 */
  local: Map<number, string>;
  /** 已經送出 LLM、還沒做完的工作 → 它的 Page。 */
  translating: Map<number, string>;
  /** 上次送出的內容與 badge；undefined＝還沒送過（或 content script 換新的了）。 */
  sent?: string;
  badge?: ActionBadge;
}

export function createPageStatusSync(deps: PageStatusSyncDeps) {
  const tabs = new Map<number, TabStatus>();
  let model: ModelStatus = { state: 'idle' };
  /** 內建翻譯的額度快用完（#237）：全域的，每個 tab 的綠點都換成橘點。 */
  let lowQuota = false;
  /** 記憶體裡沒有、正在問 isActive 的 tab。 */
  const waking = new Map<number, Promise<TabStatus | undefined>>();

  const newTab = (): TabStatus => ({ pages: [], strip: false, stripShown: false, local: new Map(), translating: new Map() });

  /**
   * 記憶體裡的 tab；沒有的話（SW 閒置被收掉、外掛重新載入）問它是不是啟動著，是就接回來。
   * 不接回來的話，SW 醒來之後這個 tab 就再也沒有全站狀態與 badge。
   */
  function tabFor(tabId: number): Promise<TabStatus | undefined> {
    const known = tabs.get(tabId);
    if (known) return Promise.resolve(known);
    const pending = waking.get(tabId);
    if (pending) return pending;
    const asking = deps.isActive(tabId).then((active) => {
      // 問的期間停止了（clear）
      if (waking.get(tabId) !== asking) return tabs.get(tabId);
      waking.delete(tabId);
      if (!active || tabs.has(tabId)) return tabs.get(tabId);
      const tab = newTab();
      tabs.set(tabId, tab);
      return tab;
    });
    waking.set(tabId, asking);
    return asking;
  }

  async function refresh(tabId: number): Promise<void> {
    const tab = tabs.get(tabId);
    if (!tab) return;
    const access = tab.pages.some(untranslatedWithoutReason) ? await deps.accessProblem() : undefined;
    const strip = tab.strip && (await deps.stripBilled());
    // 期間停止了
    if (tabs.get(tabId) !== tab) return;
    const { panel, badge } = pageStatus({ pages: tab.pages, model, inLocalPipeline: new Set(tab.local.values()), translating: new Set(tab.translating.values()), access, lowQuota, strip });
    if (strip !== tab.stripShown) {
      tab.stripShown = strip;
      deps.setStrip(tabId, strip);
    }
    const sent = JSON.stringify(panel ?? null);
    if (sent !== tab.sent) {
      tab.sent = sent;
      deps.send(tabId, panel);
    }
    if (badge !== tab.badge) {
      tab.badge = badge;
      deps.setBadge(tabId, badge);
    }
  }

  return {
    /** 沒啟動的 tab 不算（停止時 transcriber 還會 publish 一次空的）。 */
    async pagesUpdated(tabId: number, pages: PageView[], strip = false): Promise<void> {
      const tab = await tabFor(tabId);
      if (!tab) return;
      tab.pages = pages;
      tab.strip = strip;
      return refresh(tabId);
    },
    async jobEvent({ tabId, event, pageHash, job }: JobEvent): Promise<void> {
      if (event === 'enqueue') return;
      const tab = await tabFor(tabId);
      if (!tab) return;
      switch (event) {
        case 'start':
          tab.local.set(job, pageHash);
          break;
        case 'analyzed':
          tab.local.delete(job);
          break;
        case 'llm':
          tab.translating.set(job, pageHash);
          break;
        case 'drop':
        case 'done':
          tab.local.delete(job);
          tab.translating.delete(job);
          break;
      }
      return refresh(tabId);
    },
    async modelStatus(status: ModelStatus): Promise<void> {
      model = status;
      await Promise.all([...tabs.keys()].map(refresh));
    },
    /** 能不能翻譯可能變了（同意、登入、模式）。 */
    async accessChanged(): Promise<void> {
      await Promise.all([...tabs.keys()].map(refresh));
    },
    /** 剩餘額度變了（#237）：快用完時已啟動的 tab 都換成橘點，額度又夠了換回綠點。 */
    async quotaChanged(low: boolean): Promise<void> {
      lowQuota = low;
      await Promise.all([...tabs.keys()].map(refresh));
    },
    /** 啟動：badge 是小點。 */
    activated(tabId: number): Promise<void> {
      if (!tabs.has(tabId)) tabs.set(tabId, newTab());
      return refresh(tabId);
    },
    /** 重新整理、換頁：content script 是新的（圖示的 tab 專屬 badge 也被 Chrome 清掉），之後的狀態都重送。 */
    reset(tabId: number): void {
      const tab = tabs.get(tabId);
      if (!tab) return;
      tab.sent = undefined;
      tab.badge = undefined;
      // 圖示在這個 tab 的 hover 提示也被 Chrome 清掉了
      tab.stripShown = false;
      tab.local.clear();
      tab.translating.clear();
    },
    /** 停止或關 tab。 */
    clear(tabId: number): void {
      waking.delete(tabId);
      const tab = tabs.get(tabId);
      if (!tab || !tabs.delete(tabId)) return;
      deps.setBadge(tabId, undefined);
      if (tab.stripShown) deps.setStrip(tabId, false);
    },
  };
}
