/**
 * 每個分頁的 side panel 開著沒（ADR 0003）：已啟動時點圖示，關著就打開、開著才停止，所以 SW 要知道。
 * Chrome 沒有「現在開著嗎」的查詢，只能從 sidePanel.onOpened（Chrome 141）／onClosed（Chrome 142）自己記：
 * 記憶體一份給 toggle 同步讀（要在第一個 await 之前決定開不開），storage.session 一份讓 SW 休息後醒來還知道。
 *
 * SW 剛醒來、還沒讀到 storage 時，openNow 回答「這一刻」的狀態：storage 裡的，加上在這之前收到的事件。
 * 點圖示時 toggle 先問 openNow 才 open()，那次 open() 觸發的 onOpened 因此不算在「點之前」裡。
 */
export interface PanelOpenStore {
  /** side panel 開著的分頁。 */
  load(): Promise<number[]>;
  save(tabIds: number[]): Promise<void>;
}

export function createPanelOpenTracker(store: PanelOpenStore) {
  /** undefined＝還沒讀到 storage。 */
  let open: Set<number> | undefined;
  /** 讀到 storage 之前就收到的事件，讀到後依序套上去。 */
  const early: [number, boolean][] = [];
  const stored = store.load().then(
    (tabIds) => new Set(tabIds),
    (e: unknown) => {
      console.warn('side panel open state load failed', e);
      return new Set<number>();
    },
  );
  let saving = Promise.resolve();

  /** storage 裡的狀態套上這些事件。 */
  const withEvents = (base: Set<number>, events: [number, boolean][]) => {
    const state = new Set(base);
    for (const [tabId, isOpen] of events) {
      if (isOpen) state.add(tabId);
      else state.delete(tabId);
    }
    return state;
  };

  void stored.then((base) => {
    open = withEvents(base, early);
    early.length = 0;
    if (open.size !== base.size || [...open].some((tabId) => !base.has(tabId))) save();
  });

  function save(): void {
    const tabIds = [...open!];
    // 依序寫，後面的不會被前面慢的蓋掉
    saving = saving.then(() => store.save(tabIds)).catch((e: unknown) => console.warn('side panel open state save failed', e));
  }

  function set(tabId: number, isOpen: boolean): void {
    if (!open) {
      early.push([tabId, isOpen]);
      return;
    }
    if (open.has(tabId) === isOpen) return;
    if (isOpen) open.add(tabId);
    else open.delete(tabId);
    save();
  }

  return {
    opened: (tabId: number) => set(tabId, true),
    closed: (tabId: number) => set(tabId, false),
    /** 分頁關掉了。 */
    forget: (tabId: number) => set(tabId, false),
    /** 這一刻開著沒：讀到 storage 之後同步回答；還沒讀到時等讀到，只算到現在為止收到的事件。 */
    openNow(tabId: number): boolean | Promise<boolean> {
      if (open) return open.has(tabId);
      // 複製一份：讀到 storage 時 early 會清空
      const events = [...early];
      return stored.then((base) => withEvents(base, events).has(tabId));
    },
  };
}
