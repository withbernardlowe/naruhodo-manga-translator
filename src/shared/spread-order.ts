/**
 * 畫面上的 Page 照閱讀順序排，並標出每頁在 Spread 裡的哪一邊（spec #70）。side panel 的頁首與全站狀態都用它。
 */
import type { PageView } from './messages.ts';

/** Page 在 Spread 裡的哪一邊；undefined＝不是 Spread。 */
export type SpreadSide = 'right' | 'left';

export type OrderedPage = { page: PageView; side: SpreadSide | undefined };

const centerX = (page: PageView) => page.subRect && page.subRect.x + page.subRect.w / 2;

/**
 * 同一個 anchor 切出兩個 Page 才是 Spread：subRect 中心偏右的是右頁、排在前面（日漫由右往左讀），不依賴 SW 給的順序。
 * 只看 subRect 不夠：單頁去黑邊後也有 subRect。同一個 anchor 的兩個 Page 分不出左右（沒有 subRect）就不標左右，照 SW 的順序。
 */
export function readingOrder(pages: PageView[]): OrderedPage[] {
  const byAnchor = new Map<string, PageView[]>();
  for (const page of pages) byAnchor.set(page.anchorId, [...(byAnchor.get(page.anchorId) ?? []), page]);
  return [...byAnchor.values()].flatMap((group): OrderedPage[] => {
    const [a, b] = group;
    const ax = a && centerX(a);
    const bx = b && centerX(b);
    if (group.length !== 2 || ax === undefined || bx === undefined || ax === bx) return group.map((page) => ({ page, side: undefined }));
    const [right, left] = ax > bx ? [a!, b!] : [b!, a!];
    return [
      { page: right, side: 'right' },
      { page: left, side: 'left' },
    ];
  });
}
