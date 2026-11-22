/**
 * 視窗右上角的全站狀態（#185）：沒開側邊欄的讀者也看得到翻譯中。
 * unit 測不到的：SW 把狀態送到 content script、真的畫在 top layer（網站 z-index 再高的元素也蓋不到，真實的 DOM 排版），
 * 不推動網站的版面，翻完停一下說翻譯完成再收起；命中快取時不先閃處理中。顯示什麼文字、什麼時候算出問題在 src/shared/page-status.test.ts；
 * 額度用完、補同意的紅色那列在 hosted-translation.spec.ts。
 */
import type { Page } from '@playwright/test';
import { activateOnMockSite, expect, test, testActivate } from './fixtures.ts';
import { shownTranslations } from './overlay-helpers.ts';

// OCR 慢一點，處理中的狀態才看得到
test.use({ viewport: null, fakeTranslator: true, fakeOcrDelayMs: 1500 });

const status = (page: Page) => page.locator('[data-naruhodo-status]');

const firstCanvasRect = (page: Page) =>
  page.evaluate(() => {
    const { x, y, width, height } = document.querySelector('canvas')!.getBoundingClientRect();
    return { x, y, width, height };
  });

test('處理中時視窗右上角出現全站狀態，蓋在網站的控制列上面；翻完收起、網站版面不動', async ({ context, sw, extensionId, mockSite }) => {
  let before: Awaited<ReturnType<typeof firstCanvasRect>> | undefined;
  const { page } = await activateOnMockSite({
    context,
    sw,
    extensionId,
    mockSite,
    beforeActivate: async (_panel, page) => {
      // 仿閱讀器 hover 時浮出來的標題列：橫跨整個頂端、z-index 拉到最高
      await page.evaluate(() => {
        const bar = document.createElement('div');
        bar.id = 'site-toolbar';
        Object.assign(bar.style, { position: 'fixed', top: '0', left: '0', right: '0', height: '80px', zIndex: '2147483647', background: '#111' });
        document.body.append(bar);
      });
      before = await firstCanvasRect(page);
    },
  });

  await expect(status(page).getByText(/頁處理中/)).toBeVisible();
  expect(await firstCanvasRect(page)).toEqual(before);
  // 面板正中間點到的是面板自己（top layer），不是網站的標題列。截圖時面板會藏一下，所以在頁面裡一次量完、等到看得見的那一刻
  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.querySelector<HTMLElement>('[data-naruhodo-status]');
        const box = host?.getBoundingClientRect();
        if (!host || !box || box.width === 0 || host.style.visibility === 'hidden') return 'no panel';
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === host ? 'panel' : 'covered';
      }),
    )
    .toBe('panel');

  await expect(shownTranslations(page).first()).toBeVisible();
  await expect(status(page).getByText('2 頁翻譯完成')).toBeVisible();
  await expect(status(page)).toHaveCount(0);
  expect(await firstCanvasRect(page)).toEqual(before);
});

test('重新整理後命中快取：不先閃「處理中」，直接說套用快取，停一下再收起', async ({ context, sw, extensionId, mockSite }) => {
  const { page, panel, tabId } = await activateOnMockSite({ context, sw, extensionId, mockSite });
  await expect(status(page).getByText('2 頁翻譯完成')).toBeVisible();
  await expect(status(page)).toHaveCount(0);

  // 同 origin 重新整理後會自己接著啟動、馬上命中快取：摘要可能在下面的步驟做完前就收起了，所以從新頁面一開始就記下面板出現過的每一種標題
  await page.addInitScript(() => {
    const seen: string[] = ((window as unknown as { __statusTexts: string[] }).__statusTexts = []);
    // 面板畫在 shadow DOM 裡，MutationObserver 看不到：一直讀
    setInterval(() => {
      const text = document.querySelector('[data-naruhodo-status]')?.shadowRoot?.querySelector('.head')?.textContent;
      if (text && seen.at(-1) !== text) seen.push(text);
    }, 10);
  });
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await page.bringToFront();
  await testActivate(panel, tabId);

  const seen = () => page.evaluate(() => (window as unknown as { __statusTexts: string[] }).__statusTexts);
  await expect.poll(seen).toContainEqual(expect.stringMatching(/^2 頁套用快取/));
  await expect(status(page)).toHaveCount(0);
  expect((await seen()).filter((text) => text.includes('處理中'))).toEqual([]);
});
