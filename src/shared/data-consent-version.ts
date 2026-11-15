/**
 * 資料使用說明的版本與變更摘要（Data Use Consent，shared/data-consent.ts）。單獨一個檔案、不碰 chrome.*：
 * src/ui 的說明卡（data-flow.tsx）也會被產品網站 import。
 */
import type { TranslationMode } from './translation-mode.ts';

/** 每種翻譯模式目前的說明版本；版本 5 以前兩種模式一起升版。 */
export const DATA_CONSENT_VERSION: Readonly<Record<TranslationMode, number>> = { hosted: 5, ownKey: 5 };

/**
 * 上一版到目前版本改了什麼，同意過舊版的讀者在補同意卡上先看到這一行；undefined＝這次升版跟這個模式無關，不顯示。
 * 升版時跟著改（data-flow.tsx 開頭的 checklist）。
 */
export const CONSENT_CHANGES: Readonly<Record<TranslationMode, string | undefined>> = {
  hosted: '刪除帳號後，用量紀錄（只有數字）會匿名保留；猜作品名稱也會記用量。',
  ownKey: undefined,
};

