/**
 * #109：產品網站首頁的互動展示。對 `npm run site:build` 產生的 site/dist 開一個靜態 server，用一般的瀏覽器（不載入外掛）操作。
 * unit 抓不到的：Astro／Vite 打包外掛元件的整條路（.css 變字串、字型檔、Practice Spread 的圖）、SidePanel 在 shadow root 裡真的
 * render、覆蓋層在真正的版面上（圖是整張跨頁、只露出右頁，譯文要對到右半張） hover 出 tooltip 並跟 side panel 同步高亮，以及展示時沒有對外的網路請求。
 * 展示的進度（辨識中 → 翻譯中 → 完成、剩餘頁數、圖示當開關）是 site/src/demo/demo-state.test.ts。
 */
import { test as base, expect } from '@playwright/test';
import { demoPages } from '../site/src/demo/demo-page.ts';
import { startSiteServer } from './site-server.ts';

const test = base.extend<{ siteOrigin: string }>({
  siteOrigin: async ({}, use) => {
    const site = await startSiteServer();
    await use(site.origin);
    await site.close();
  },
});

test('首頁展示：點圖示 → 翻譯中光帶 → 翻譯完成 → 閱讀時滑過是編號 → 切到學習看到 tooltip，全程不連外', async ({ page, siteOrigin }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(`${siteOrigin}/zh-tw/`);

  const demo = page.locator('.demo-chrome');
  await demo.getByRole('button', { name: 'Naruhodo', exact: true }).click();
  // Playwright 的 locator 會穿進 open shadow root
  const panel = demo.locator('.naru-side-panel');
  // 翻譯中：外掛的光帶（不是展示自己畫的效果）
  await expect(demo.locator('[data-naruhodo-overlay] .wash').first()).toBeAttached();
  await expect(panel.getByRole('status', { name: '剩餘額度' })).toHaveText(/免費額度剩 99 頁/);

  const balloons = demoPages.flatMap((p) => p.text.balloons);
  const translations = demo.locator('[data-naruhodo-overlay] [data-balloon-id]');
  await expect(translations.filter({ visible: true })).toHaveCount(balloons.length);
  await expect(demo.locator('[data-naruhodo-overlay] .wash')).toHaveCount(0);

  // 閱讀模式、side panel 開著：跟外掛一樣不出 tooltip，對話框上標逐字稿的編號（hover-aid.ts）
  const read = translations.first();
  await read.scrollIntoViewIfNeeded();
  const readBox = (await read.boundingBox())!;
  await page.mouse.move(readBox.x + readBox.width / 2, readBox.y + readBox.height / 2);
  await expect(demo.locator('[data-naruhodo-overlay] .num.on')).toHaveCount(1);
  await expect(demo.locator('[data-naruhodo-overlay] .tip.on')).toHaveCount(0);
  await page.mouse.move(1, 1);

  await panel.getByRole('button', { name: /^學習/ }).click();
  await expect(translations.filter({ visible: true })).toHaveCount(0);

  // 譯文元素藏起來後 rect 不變（visibility），拿它當 Balloon 的位置；漫畫頁會捲動，先捲到看得到
  const first = translations.first();
  await first.scrollIntoViewIfNeeded();
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const tooltip = demo.locator('[data-naruhodo-overlay] .tip.on');
  await expect(tooltip).toHaveCount(1);
  const id = await first.getAttribute('data-balloon-id');
  // 學習時 tooltip 是原文夾著振り仮名（rt），拿掉再比
  const withoutRuby = await tooltip.evaluate((tip) => {
    const copy = tip.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('rt').forEach((rt) => rt.remove());
    return copy.textContent;
  });
  expect(withoutRuby).toContain(balloons.find((b) => b.id === id)!.原文);
  // 同步高亮：side panel 逐字稿裡那句也亮起來
  await expect(panel.locator('li.hl')).toHaveCount(1);

  // 圖示是開關：再點一次停止、關掉 side panel、拿掉譯文；再點又重新翻一次
  const icon = demo.getByRole('button', { name: 'Naruhodo', exact: true });
  await icon.click();
  await expect(icon).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toHaveCount(0);
  await expect(translations).toHaveCount(0);
  await icon.click();
  await expect(panel.getByRole('status', { name: '剩餘額度' })).toHaveText(/免費額度剩 99 頁/);
  // side panel 的「停止」跟外掛一樣：停止並關掉 side panel
  await panel.getByRole('button', { name: '停止翻譯這個分頁' }).click();
  await expect(icon).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toHaveCount(0);

  expect(requests.filter((url) => !url.startsWith(`${siteOrigin}/`))).toEqual([]);
});

// #330 的羅馬拼音按詞對應也要在展示看得到：demo-page.json 有按詞羅馬拼音、展示開著羅馬拼音。
// 詞怎麼切、外掛裡的 hover 細節是 learning.spec.ts；這裡只測展示把資料與設定接上了
test('首頁展示：羅馬拼音按詞，滑過逐字稿或 tooltip 的詞，日文與羅馬拼音一起亮', async ({ page, siteOrigin }) => {
  await page.goto(`${siteOrigin}/zh-tw/`);
  const demo = page.locator('.demo-chrome');
  await demo.getByRole('button', { name: 'Naruhodo', exact: true }).click();
  const panel = demo.locator('.naru-side-panel');
  await panel.getByRole('button', { name: /^學習/ }).click();

  const first = demoPages[0]!.text.balloons[0]!;
  const words = first.羅馬拼音分詞!.map((w) => w.羅馬拼音);
  // 外層的 Page 也是 listitem，只拿逐字稿裡的那一句
  const line = panel.getByRole('list', { name: '逐字稿' }).getByRole('listitem').filter({ hasText: words.join(' ') });
  const latin = line.locator('[lang="ja-Latn"] .w');
  await expect(latin).toHaveText(words);
  const lit = line.locator('.w.on');
  await latin.filter({ hasText: 'kyodaina' }).hover();
  await expect(lit).toHaveText([/^巨大/, 'kyodaina']);

  // tooltip：滑進 Balloon 出 tooltip，再移到 tooltip 的羅馬拼音上。
  // 展示框捲到畫面頂端：只捲到看得到 Balloon 的話，它下面的 tooltip 可能落在視窗外，滑鼠移不過去
  const balloon = demo.locator(`[data-naruhodo-overlay] [data-balloon-id="${first.id}"]`);
  await demo.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const box = (await balloon.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const tooltip = demo.locator('[data-naruhodo-overlay] .tip.on');
  await expect(tooltip.locator('.tip-romaji .w')).toHaveText(words);
  const word = (await tooltip.locator('.tip-romaji .w').filter({ hasText: 'kyodaina' }).boundingBox())!;
  await page.mouse.move(word.x + word.width / 2, word.y + word.height / 2, { steps: 20 });
  await expect(tooltip.locator('.w.on')).toHaveText([/^巨大/, 'kyodaina']);

  // ⚙ 可以關掉羅馬拼音：逐字稿與 tooltip 都不再有羅馬拼音
  await page.mouse.move(1, 1);
  await panel.getByRole('button', { name: '設定' }).click();
  await panel.getByRole('switch', { name: '讀音加上羅馬拼音' }).click();
  await panel.getByRole('button', { name: '返回' }).click();
  await expect(panel.locator('[lang="ja-Latn"]')).toHaveCount(0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip.locator('.tip-romaji')).toHaveCount(0);
});
