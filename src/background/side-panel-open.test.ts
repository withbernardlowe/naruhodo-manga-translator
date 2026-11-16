import { describe, expect, it } from 'vitest';
import { createPanelOpenTracker } from './side-panel-open.ts';

/** 模擬 storage.session：load 可以卡住，模擬 SW 剛醒來還沒讀到。 */
function fakeSession(initial: number[]) {
  let saved = initial;
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  return {
    store: {
      load: async () => {
        await gate;
        return saved;
      },
      save: async (tabIds: number[]) => void (saved = tabIds),
    },
    saved: () => saved,
    /** 讓 load 讀完。 */
    loaded: async () => {
      release();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe('每個分頁的側邊欄開著沒（sidePanel.onOpened／onClosed）', () => {
  it('讀到 storage 之後同步回答（點圖示時要在第一個 await 之前決定）', async () => {
    const session = fakeSession([1]);
    const panels = createPanelOpenTracker(session.store);
    await session.loaded();

    expect(panels.openNow(1)).toBe(true);
    expect(panels.openNow(2)).toBe(false);
  });

  it('打開、關掉都記下來，也存回 storage（SW 休息後還在）', async () => {
    const session = fakeSession([]);
    const panels = createPanelOpenTracker(session.store);
    await session.loaded();

    panels.opened(1);
    panels.opened(2);
    panels.closed(1);
    await new Promise((r) => setTimeout(r, 0));

    expect(panels.openNow(1)).toBe(false);
    expect(panels.openNow(2)).toBe(true);
    expect(session.saved()).toEqual([2]);
  });

  it('SW 剛醒來還沒讀到 storage：回答等讀到才知道', async () => {
    const session = fakeSession([1]);
    const panels = createPanelOpenTracker(session.store);

    const now = panels.openNow(1);
    await session.loaded();

    expect(now).toBeInstanceOf(Promise);
    expect(await now).toBe(true);
  });

  it('點圖示叫醒 SW、自己 open() 觸發的 onOpened 比 storage 先到：點的當下仍算關著', async () => {
    const session = fakeSession([]);
    const panels = createPanelOpenTracker(session.store);

    const atClick = panels.openNow(1);
    panels.opened(1);
    await session.loaded();

    expect(await atClick).toBe(false);
    expect(panels.openNow(1)).toBe(true);
    expect(session.saved()).toEqual([1]);
  });

  it('讀者按 × 叫醒 SW、storage 還沒讀到就點圖示：點的當下已經是關著', async () => {
    const session = fakeSession([1]);
    const panels = createPanelOpenTracker(session.store);

    panels.closed(1);
    const atClick = panels.openNow(1);
    await session.loaded();

    expect(await atClick).toBe(false);
  });

  it('分頁關掉就忘掉', async () => {
    const session = fakeSession([1]);
    const panels = createPanelOpenTracker(session.store);
    await session.loaded();

    panels.forget(1);
    await new Promise((r) => setTimeout(r, 0));

    expect(panels.openNow(1)).toBe(false);
    expect(session.saved()).toEqual([]);
  });
});
