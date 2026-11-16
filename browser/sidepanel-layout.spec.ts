/**
 * #77：side panel 的版面。底部系列名稱原本是一個很寬的下拉選單，把窄的 side panel 撐出水平捲軸；#186 起作品在 Transcript 上方的作品卡。
 */
import type { Page } from '@playwright/test';
import { activateOnMockSite, expect, openSettings, test } from './fixtures.ts';

/** Chrome side panel 能拉到的最窄寬度附近。 */
const NARROW = { width: 320, height: 800 };

const LONG_NAME = 'ある日突然、異世界の大魔法使いの弟子になった件について 第二部';

/** 整頁沒有水平捲軸：內容寬度不超過可視寬度。 */
async function expectNoHorizontalScroll(panel: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await panel.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/** 跟 series.spec.ts 一樣用真的視窗：仿 canvas 網站兩頁都截得到。 */
test.use({ fakeTranslator: true, viewport: null });

test('窄寬度下 side panel 沒有水平捲軸', async ({ context, sw, extensionId, mockSite }) => {
  const { panel } = await activateOnMockSite({ context, sw, extensionId, mockSite });
  await expect(panel.getByRole('status', { name: '翻譯狀態' }).filter({ hasText: /^已翻譯・/ })).toHaveCount(2);
  // mock 網站的作品名很短；真實網站的作品名與網域長得多，舊版的下拉選單縮不到比最長選項窄
  // 作品在標題列（U13：原本的作品卡）
  const card = panel.getByRole('heading', { level: 1 });
  const identity = panel.getByRole('region', { name: '作品身分' });
  const picker = panel.getByRole('region', { name: '換一部作品' });
  const back = () => panel.getByRole('button', { name: '返回' }).click();
  await card.getByRole('button', { name: /^作品：/ }).click();
  await identity.getByRole('button', { name: '改名' }).click();
  await identity.getByRole('textbox', { name: '作品名稱' }).fill(LONG_NAME);
  await identity.getByRole('button', { name: '儲存' }).click();
  await expect(identity).toContainText(LONG_NAME);
  await panel.setViewportSize(NARROW);

  // 作品頁（長名稱、角色與用語表格）與換一部作品（長名稱與合併的下拉選單）都不撐開（#191）
  await expectNoHorizontalScroll(panel);
  await identity.getByRole('button', { name: '不是這部作品？' }).click();
  await expect(picker).toBeVisible();
  await expectNoHorizontalScroll(panel);
  await back();
  await back();
  // 平常：標題列的長名稱換行或截斷，不撐開
  await expect(card).toContainText(LONG_NAME);
  await expectNoHorizontalScroll(panel);
  // ⚙ 打開的設定頁也一樣
  await openSettings(panel);
  await expectNoHorizontalScroll(panel);
});

/**
 * 字型：side panel 只用系統字型（src/shared/tokens.css），譯文的幾個標點例外（打包的 Noto Sans TC）。清單怎麼排由 src/shared/tokens.test.ts 檢查；
 * 實際畫字用了哪個字型（缺字時 Chrome 會改用別的字型補、system-ui 會跟著作業系統語系），要真的 Chrome 才看得到。
 * 只在 Windows 與 macOS 跑：CI 的 Linux 沒有這兩個系統的字型，結果沒有意義。
 */
test('逐字稿的日文全部用日文系統字型、中文全部用中文系統字型，沒有混用', async ({ context, sw, extensionId, mockSite }) => {
  test.skip(process.platform === 'linux', 'Linux 沒有 Windows／macOS 的系統字型');
  const { panel } = await activateOnMockSite({ context, sw, extensionId, mockSite });
  const transcript = panel.getByRole('list', { name: 'Page' }).getByRole('listitem', { name: '第 1 頁' }).getByRole('list', { name: '逐字稿' });
  await expect(transcript.locator('[lang="zh-Hant"]').first()).toBeVisible();

  // 每個字實際用哪個字型畫（含缺字時補上的字型）：CDP 的 CSS.getPlatformFontsForNode
  const cdp = await context.newCDPSession(panel);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const fontsFor = async (lang: string) => {
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: `ol[aria-label="逐字稿"] [lang="${lang}"]` });
    expect(nodeIds.length).toBeGreaterThan(0);
    const used = new Set<string>();
    for (const nodeId of nodeIds) for (const f of (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts) used.add(f.familyName);
    return [...used];
  };
  const japanese = ['Hiragino Sans', 'Yu Gothic UI', 'Yu Gothic'];
  const chinese = ['PingFang TC', 'Microsoft JhengHei UI', 'Microsoft JhengHei'];
  // 譯文的標點用打包的 Noto Sans TC（src/shared/punctuation-face.ts）；CDP 報的是字型檔裡的名稱
  const punctuation = 'Noto Sans TC';
  const ja = await fontsFor('ja');
  const zh = await fontsFor('zh-Hant');
  expect(ja.filter((f) => !japanese.includes(f)), `日文用了 ${ja.join('、')}`).toEqual([]);
  expect(zh.filter((f) => !chinese.includes(f) && f !== punctuation), `中文用了 ${zh.join('、')}`).toEqual([]);
  expect(zh, `中文用了 ${zh.join('、')}`).toContain(punctuation);
});

test.describe('逐字稿出來之前', () => {
  // 顯示層級的按鈕要等逐字稿出來才有；FakeEngine 幾乎不花時間，讓它慢到測試結束都還沒出來
  test.use({ fakeOcrDelayMs: 60_000 });

  // 哪則提示排前面是 view.test.ts 的 panelNotices；這裡確認真的畫面上只出現一張、其他收起來，處理完下一張補上
  test('頂部只有作品名稱、停止、⚙ 與 Page Mode 切換；提示一次只顯示一張', async ({ context, sw, extensionId, mockSite }) => {
    const { panel } = await activateOnMockSite({ context, sw, extensionId, mockSite });
    const main = panel.getByRole('main');

    // 標題列是作品名稱（U13：Chrome 的側邊面板標題列已經寫了 Naruhodo），沒有「已啟動」（有停止就代表在翻）
    await expect(main.getByRole('heading', { level: 1 }).getByRole('button', { name: /^作品：/ })).toBeVisible();
    await expect(main.getByText('已啟動')).toHaveCount(0);
    // 還沒同意資料使用時，說明卡片排第一（translate.spec.ts 測它），作品確認收在「還有 1 則提示」裡（U14）
    const consent = main.getByRole('region', { name: '資料使用說明' });
    const ask = main.getByRole('group', { name: '確認作品' });
    const more = main.getByRole('button', { name: '還有 1 則提示 確認作品' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(ask).toHaveCount(0);
    await more.click();
    await expect(ask).toBeVisible();
    await main.getByRole('button', { name: '收起' }).click();
    await expect(ask).toHaveCount(0);
    await consent.getByRole('button', { name: '同意並啟用翻譯' }).click();
    await expect(consent).toHaveCount(0);
    await expect(ask).toBeVisible();
    await expect(main.getByRole('button', { name: /^還有/ })).toHaveCount(0);
    // Page 列表與逐字稿之前的控制項：作品名稱（打開作品頁，#191）、停止（ADR 0003）、⚙（只有圖示）、Page Mode 兩格、作品確認（#186）。
    // 逐字稿標題列的顯示選單要等逐字稿出來，不在這裡
    await expect(main.getByRole('button').filter({ visible: true })).toHaveText([/›$/, '停止', '', '閱讀', '學習', '是', '換一部']);
    await expect(main.getByRole('switch')).toHaveCount(0);
    // Page Mode 那一行寫明管的是漫畫頁面（U15）；兩種模式的說明在 hover 提示，學習的說明也講到逐字稿
    await expect(main.getByText('漫畫頁面', { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: '學習', exact: true })).toHaveAccessibleDescription(/逐字稿的譯文也先收起來/);
    await expect(main.getByRole('button', { name: /^逐字稿顯示/ })).toHaveCount(0);

    // ⚙ 直接打開設定頁（沒有選單）
    await openSettings(panel);
  });
});
