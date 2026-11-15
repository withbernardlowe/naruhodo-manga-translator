/** 畫面上連到的文件。網站上線（#97）前先連 repo 裡的原文。 */
const REPO = 'https://github.com/yurenju/naruhodo-manga-translator/blob/main';

export const PRIVACY_URL = `${REPO}/PRIVACY.md`;
export const TERMS_URL = `${REPO}/TERMS.md`;

/** 討論區：回報問題、提問、建議都到這裡（issue 只開放給 collaborator）。官網的頁尾與 FAQ 也用這個。 */
export const DISCUSSIONS_URL = 'https://github.com/yurenju/naruhodo-manga-translator/discussions';

/** Discussions 的「翻譯問題回報」分類的 slug；表單是 .github/DISCUSSION_TEMPLATE/<slug>.yml，兩邊要一起改。 */
export const PROBLEM_REPORT_CATEGORY = '翻譯問題回報';

/** side panel 的「回報翻譯問題」打開這裡。內容只走剪貼簿、不放進網址（PRIVACY.md「Reporting a problem」）。 */
export const PROBLEM_REPORT_URL = `${DISCUSSIONS_URL}/new?category=${encodeURIComponent(PROBLEM_REPORT_CATEGORY)}`;

/** 帳號、付款、個資這類不該公開貼出來的問題寄這裡（TERMS.md 第 14 節）。官網也用這個。 */
export const CONTACT_EMAIL = 'dev@sadcoder.com';

/** 網站上的試翻頁（#169）：onboarding 第 4 步用新分頁打開。外掛介面只有中文，所以固定中文版。 */
export const PRACTICE_URL = 'https://naruhodo.page/zh-tw/try/';
