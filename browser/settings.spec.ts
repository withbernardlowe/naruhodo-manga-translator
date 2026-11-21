/**
 * 設定頁（#326）：manifest 的 options_ui，Chrome 的「選項」打開。分類與 hash 的規則在 src/ui/settings-route.test.ts，
 * 這裡是 unit 看不到的接線：Chrome 真的用 options_ui 打開這一頁、已經開著不多開；hash 換畫面、重新整理還在同一類；
 * 設定頁與側邊欄 ⚙ 聽同一份 storage；帳號與訂閱子畫面與舊的 account.html 轉址；onboarding 沒做完只有「完成設定」。
 */
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, openSettings, openSidePanel, test } from './fixtures.ts';

/**
 * 等同 Chrome 的「選項」：chrome.runtime.openOptionsPage 走同一條（已經開著就切過去）。
 * 沒開著時 Chrome 會直接把空白分頁換成設定頁、不一定開新分頁，所以等某個分頁變成設定頁，不等 page 事件。
 */
async function openOptions(context: BrowserContext, sw: Worker): Promise<Page> {
  await sw.evaluate(() => chrome.runtime.openOptionsPage());
  const isSettings = (p: Page) => new URL(p.url()).pathname === '/settings.html';
  await expect.poll(() => context.pages().some(isSettings)).toBe(true);
  const page = context.pages().find(isSettings)!;
  await page.waitForLoadState();
  return page;
}

const nav = (page: Page) => page.getByRole('navigation', { name: '設定分類' });

test('從「選項」打開設定頁：左側導覽切換分類、重新整理還是同一類；再開一次切回同一個分頁；跟側邊欄 ⚙ 的開關同步', async ({ context, sw, extensionId }) => {
  const settings = await openOptions(context, sw);
  await expect(nav(settings).getByRole('button', { name: /^翻譯與帳號/ })).toHaveAttribute('aria-current', 'page');
  await expect(settings.getByRole('radiogroup', { name: '翻譯方式' })).toBeVisible();

  await nav(settings).getByRole('button', { name: /^閱讀與顯示/ }).click();
  await expect(settings).toHaveURL(/#display$/);
  const display = settings.getByRole('region', { name: '閱讀與顯示' });
  await expect(display.getByRole('group', { name: '頁面模式' })).toBeVisible();
  await settings.reload();
  await expect(display.getByRole('switch', { name: '讀音加上羅馬拼音' })).toBeVisible();

  // 已經開著：不多開一個分頁
  const pages = context.pages().length;
  await sw.evaluate(() => chrome.runtime.openOptionsPage());
  await expect.poll(() => sw.evaluate(async () => (await chrome.tabs.query({ url: chrome.runtime.getURL('settings.html*') })).length)).toBe(1);
  expect(context.pages()).toHaveLength(pages);

  // 設定頁改了，側邊欄 ⚙ 立刻跟著變；反過來也一樣
  const panel = await openSidePanel(context, extensionId);
  await openSettings(panel);
  const panelRomaji = panel.getByRole('region', { name: '設定' }).getByRole('switch', { name: '讀音加上羅馬拼音' });
  await expect(panelRomaji).not.toBeChecked();
  await display.getByRole('switch', { name: '讀音加上羅馬拼音' }).click();
  await expect(panelRomaji).toBeChecked();
  await panel.getByRole('region', { name: '設定' }).getByRole('switch', { name: '點圖示時也打開側邊欄' }).click();
  await expect(display.getByRole('switch', { name: '點圖示時也打開側邊欄' })).not.toBeChecked();
  // 側邊欄不放頁面模式：主畫面本來就有「漫畫頁面」那一列
  await expect(panel.getByRole('region', { name: '設定' }).getByRole('group', { name: '頁面模式' })).toHaveCount(0);
});

test('帳號與訂閱是「翻譯與帳號」底下的子畫面：麵包屑回到上一層；舊的 account.html 帶著 from 轉到 #account', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/account.html?from=7`);
  await expect(page).toHaveURL(`chrome-extension://${extensionId}/settings.html?from=7#account`);
  await expect(page.getByRole('heading', { level: 1, name: '帳號與訂閱' })).toBeVisible();
  // 沒登入：帳號與訂閱裡是登入
  await expect(page.getByRole('main').getByRole('button', { name: '登入' })).toBeVisible();

  const crumb = page.getByRole('navigation', { name: '位置' });
  await expect(crumb).toHaveText('翻譯與帳號›帳號與訂閱');
  await crumb.getByRole('button', { name: '翻譯與帳號' }).click();
  await expect(page).toHaveURL(/#translation$/);
  await expect(page.getByRole('radiogroup', { name: '翻譯方式' })).toBeVisible();
  // 瀏覽器的上一頁回到子畫面
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: '帳號與訂閱' })).toBeVisible();
});

test.describe('onboarding 還沒做完', () => {
  test.use({ freshInstall: true });

  test('設定頁跟側邊欄一樣只有「完成設定」，選不了翻譯方式', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings.html#translation`);
    await expect(page.getByRole('button', { name: '完成設定' })).toBeVisible();
    await expect(page.getByText('設定還沒完成')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: '翻譯方式' })).toHaveCount(0);
    await expect(nav(page)).toHaveCount(0);
  });
});
