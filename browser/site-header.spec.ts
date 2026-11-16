/**
 * 產品網站頁首的「討論區」連結。對 `npm run site:build` 產生的 site/dist 開靜態 server，用一般的瀏覽器（不載入外掛）。
 * unit 抓不到的是真正的排版：手機寬度下頁首塞得下討論區而不撐出橫向捲動；法律文件兩種語言都輸出，
 * 藏起另一種語言的 CSS 不能被連結自己的 display 蓋掉（加討論區時就發生過，兩種語言同時出現）。
 */
import { test as base, expect } from '@playwright/test';
import { DISCUSSIONS_URL } from '../src/ui/links.ts';
import { startSiteServer } from './site-server.ts';

const test = base.extend<{ siteOrigin: string }>({
  siteOrigin: async ({}, use) => {
    const site = await startSiteServer();
    await use(site.origin);
    await site.close();
  },
});

test('頁首討論區：手機寬度也看得到且不撐出橫向捲動，法律文件只顯示讀者語言那一份', async ({ page, siteOrigin }) => {
  await page.setViewportSize({ width: 360, height: 740 });

  const pages = [
    { path: '/zh-tw/', name: '討論區' },
    { path: '/en/', name: 'Community' },
    { path: '/privacy/?lang=zh-tw', name: '討論區' },
    { path: '/privacy/?lang=en', name: 'Community' },
  ];
  for (const { path, name } of pages) {
    await page.goto(`${siteOrigin}${path}`);
    const links = page.locator('.site-header').getByRole('link', { name: /討論區|Community/ });
    await expect(links, path).toHaveCount(1);
    await expect(links, path).toHaveAccessibleName(name);
    await expect(links, path).toHaveAttribute('href', DISCUSSIONS_URL);
    await expect(links, path).toBeInViewport({ ratio: 1 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
