/**
 * 帳號與訂閱（#213）的網址：設定頁「翻譯與帳號」底下的子畫面 settings.html#account（#326）。
 * 右鍵選單「帳號與訂閱」直接打開；額度用完時全站狀態裡的「查看方案」、點圖示，以及 side panel 的「查看方案」
 * 帶著漫畫分頁打開（from，「回到漫畫」切回去）。沒登入、自備金鑰沒有 key 還是打開 onboarding 的那一步。
 * 舊的 account.html 只剩轉址到這裡（已經開著或被記下來的分頁不會壞掉）。
 */
import { onboardingQuery, type RequestedStep } from './onboarding.ts';

export function accountQuery(from?: number): string {
  return from === undefined ? '' : `?from=${from}`;
}

export function accountRequest(search: string): { from?: number } {
  const from = Number(new URLSearchParams(search).get('from') ?? NaN);
  return Number.isInteger(from) ? { from } : {};
}

/** 帳號與訂閱的路徑（相對外掛根目錄）：query 在 hash 前面，設定頁用 location.search 讀 from。 */
export const accountPath = (from?: number): string => `settings.html${accountQuery(from)}#account`;

/** 卡住時打開的外掛頁面（相對外掛根目錄）：額度用完是帳號與訂閱，其他是 onboarding 的那一步。 */
export function blockedPagePath(step: RequestedStep, from?: number): string {
  return step === 'plan' ? accountPath(from) : `onboarding.html${onboardingQuery(step, from)}`;
}

/** 外掛自己的帳號與訂閱。from＝來源的漫畫分頁（side panel 的「查看方案」）；右鍵選單、設定的「管理帳號與訂閱」沒有。 */
export function accountUrl(from?: number): string {
  return chrome.runtime.getURL(accountPath(from));
}

export function blockedPageUrl(step: RequestedStep, from?: number): string {
  return chrome.runtime.getURL(blockedPagePath(step, from));
}
