/**
 * Problem Report（GLOSSARY）：side panel 的「回報翻譯問題」→ 報告進剪貼簿、打開 Discussions 的回報表單。
 * 報告長什麼樣（JSON 欄位、沒有對白和圖片）是 shared/problem-report.test.ts 的 unit；這裡看 unit 看不到的接線：
 * side panel → SW → content script 補上網址、畫面大小、捲動位置與快取紀錄，真的寫進剪貼簿，並開了新分頁。
 */
import { activateOnMockSite, expect, test } from './fixtures.ts';

test.use({ viewport: null, fakeTranslator: true });

test('按「回報翻譯問題」：報告複製到剪貼簿（含網址、畫面、捲動位置、快取紀錄），打開回報表單', async ({ context, sw, extensionId, mockSite }) => {
  const { panel } = await activateOnMockSite({ context, sw, extensionId, mockSite });
  type Recorded = { __copied?: string; __opened?: string[] };
  await panel.evaluate(() => {
    const w = window as unknown as Recorded;
    // 外掛頁面的 origin 拿不到 clipboard-read（Playwright 的 grantPermissions 不接受），寫入時順便記下來；真的寫入照做，失敗 test 就失敗
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text: string) => {
      await write(text);
      w.__copied = text;
    };
    // 不真的連到 GitHub：context.route 攔不到 chrome.tabs.create 開的分頁
    w.__opened = [];
    chrome.tabs.create = (async (props: chrome.tabs.CreateProperties) => void w.__opened!.push(props.url!)) as unknown as typeof chrome.tabs.create;
  });

  const report = panel.getByRole('region', { name: '回報翻譯問題' });
  await expect(report.getByRole('button', { name: '回報翻譯問題' })).toBeVisible();
  // 剪貼簿只寫得進有焦點的頁面：真的 side panel 被點的時候就有焦點
  await panel.bringToFront();
  await report.getByRole('button', { name: '回報翻譯問題' }).click();

  await expect(report.getByRole('status')).toContainText('報告已複製');
  const { __copied: text, __opened: opened } = await panel.evaluate(() => {
    const { __copied, __opened } = window as unknown as Recorded;
    return { __copied, __opened };
  });
  expect(opened!.map(decodeURIComponent)).toEqual(['https://github.com/yurenju/naruhodo-manga-translator/discussions/new?category=翻譯問題回報']);
  if (text === undefined) throw new Error('沒有寫進剪貼簿');
  const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)![1]!);
  expect(json.pageUrl).toBe(new URL(mockSite.canvasSiteUrl).origin + new URL(mockSite.canvasSiteUrl).pathname);
  expect(json.viewport.width).toBeGreaterThan(0);
  expect(json.devicePixelRatio).toBeGreaterThan(0);
  expect(json.scroll.height).toBeGreaterThan(0);
  expect(json.pages[0].lines[0]).toMatchObject({ id: 'P1-L1', chars: expect.any(Number) });
  expect(json.pages[0].promptVersion).toEqual(expect.any(String));
  expect(text).not.toContain('data:image');
});
