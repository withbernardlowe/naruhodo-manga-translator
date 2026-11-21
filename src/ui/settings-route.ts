/**
 * 設定（#326）的三個分類：設定頁的左側導覽與側邊欄 ⚙ 的三個小標用同一份，名稱與順序一樣。
 * 設定頁一次只顯示一類，每一類有自己的 hash；帳號與訂閱（原本的 account.html）是「翻譯與帳號」底下的子畫面。
 */
export type SettingsCategory = 'translation' | 'display' | 'data';

/** sub：左側導覽每一項底下的副標；intro：設定頁標題下面的一行說明（側邊欄沒有）。 */
export const SETTINGS_CATEGORIES: readonly { id: SettingsCategory; label: string; sub: string; intro: string }[] = [
  { id: 'translation', label: '翻譯與帳號', sub: '翻譯方式、帳號、方案與額度', intro: '誰幫你翻、用誰的額度。內建翻譯要登入帳號；自備金鑰不用。' },
  { id: 'display', label: '閱讀與顯示', sub: '閱讀／學習、羅馬拼音、側邊欄', intro: '漫畫頁面、tooltip 與側邊欄要長什麼樣子。' },
  { id: 'data', label: '資料與回饋', sub: '匯出匯入、回報問題', intro: '搬家、備份，或告訴我們哪裡翻得不好。' },
];

/** 設定頁現在顯示哪個畫面：account＝「翻譯與帳號 › 帳號與訂閱」子畫面。 */
export interface SettingsRoute {
  category: SettingsCategory;
  account: boolean;
}

const ACCOUNT_HASH = '#account';

/** 網址的 hash → 畫面。沒有 hash（Chrome 的「選項」打開的）或認不得的都開「翻譯與帳號」。 */
export function settingsRoute(hash: string): SettingsRoute {
  if (hash === ACCOUNT_HASH) return { category: 'translation', account: true };
  const category = SETTINGS_CATEGORIES.find(({ id }) => `#${id}` === hash)?.id ?? 'translation';
  return { category, account: false };
}

export function settingsHash({ category, account }: SettingsRoute): string {
  return account ? ACCOUNT_HASH : `#${category}`;
}
