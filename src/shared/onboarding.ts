/**
 * 全頁 onboarding（#93）的進度與內建翻譯提示，存在 chrome.storage.local。
 * SW 在安裝／更新時寫（background/install.ts），onboarding 頁每走一步寫，side panel 讀：
 * 沒做完就只顯示「完成設定」，按了打開 onboarding、回到停下來的那一步。
 */
import type { RequestedStep } from './onboarding-step.ts';
import type { TranslationMode } from './translation-mode.ts';
import { watchLocal } from './watch-local.ts';

/**
 * onboarding 的步驟（第 1–4 步）；ownKey＝頁尾「使用自備金鑰」換成的畫面，consent＝還登入著、只補同意資料使用說明，
 * return＝卡住或重新登入、解決後的「回到漫畫」（沒有漫畫分頁時是「可以關掉這個分頁」）；這三個都不在步驟裡。
 */
export type OnboardingStep = 'intro' | 'signIn' | 'consent' | 'plan' | 'tutorial' | 'ownKey' | 'return';

/**
 * 進度：停在哪一步，done＝設定完成（選了方案或存了自己的 key；第 4 步只是教學）。
 * 沒有值＝#93 以前就裝好的外掛（e2e build 預設也是），當作完成。
 */
export type OnboardingProgress = 'intro' | 'signIn' | 'plan' | 'done';

const PROGRESS_KEY = 'onboarding';
/** true＝從舊版更新、仍用自備金鑰的讀者還沒看過（或還沒關掉）內建翻譯提示。 */
const HINT_KEY = 'hostedHint';

const PROGRESS: readonly OnboardingProgress[] = ['intro', 'signIn', 'plan', 'done'];

const parseProgress = (value: unknown): OnboardingProgress => (PROGRESS.includes(value as OnboardingProgress) ? (value as OnboardingProgress) : 'done');

export type { RequestedStep };

const REQUESTED: readonly RequestedStep[] = ['signIn', 'consent', 'plan', 'ownKey'];

/**
 * 重新登入：設定早就完成、而且已經在用內建翻譯（只是登出過或同意過期）。登入或補同意就解決了，直接「回到漫畫」，
 * 不走選擇方案與試翻頁、不顯示進度點。「改用內建翻譯」的人（還在用自備金鑰）不算，第一次用內建翻譯要看方案。
 */
export const isReauth = (progress: OnboardingProgress, mode: TranslationMode): boolean => progress === 'done' && mode === 'hosted';

/** 開 onboarding 當下的帳號狀態：signedIn＝有內建翻譯的 token，consented＝同意了目前版本的內建翻譯說明，reauth 見 isReauth。 */
export interface StartState {
  signedIn: boolean;
  consented: boolean;
  reauth: boolean;
}

/**
 * onboarding 頁從哪一步開始：要的是「登入」「補同意」或「選擇方案」就從第 2 步；沒登入先登入，還登入著只差同意就只補同意；
 * 都好了就到選擇方案，重新登入（reauth）的話直接「回到漫畫」。
 */
export function startStep(progress: OnboardingProgress, { signedIn, consented, reauth }: StartState, requested?: RequestedStep): OnboardingStep {
  if (requested === 'ownKey') return 'ownKey';
  const step = requested ?? (progress === 'done' ? 'intro' : progress);
  if (step === 'intro') return 'intro';
  if (!signedIn) return 'signIn';
  if (!consented) return 'consent';
  return reauth && step !== 'plan' ? 'return' : 'plan';
}

/** 網址的 query：step＝從哪一步開始，from＝點圖示的那個漫畫分頁（完成後「回到漫畫」切回去）。 */
export function onboardingQuery(step?: RequestedStep, from?: number): string {
  const params = new URLSearchParams();
  if (step) params.set('step', step);
  if (from !== undefined) params.set('from', String(from));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function onboardingRequest(search: string): { step?: RequestedStep; from?: number } {
  const params = new URLSearchParams(search);
  const step = params.get('step') as RequestedStep | null;
  const from = Number(params.get('from') ?? NaN);
  return { ...(step && REQUESTED.includes(step) ? { step } : {}), ...(Number.isInteger(from) ? { from } : {}) };
}

/** 外掛自己的 onboarding 頁。 */
export function onboardingUrl(step?: RequestedStep, from?: number): string {
  return chrome.runtime.getURL(`onboarding.html${onboardingQuery(step, from)}`);
}

export async function loadOnboarding(): Promise<OnboardingProgress> {
  return parseProgress((await chrome.storage.local.get(PROGRESS_KEY))[PROGRESS_KEY]);
}

export function saveOnboarding(progress: OnboardingProgress): Promise<void> {
  return chrome.storage.local.set({ [PROGRESS_KEY]: progress });
}

export function dismissHostedHint(): Promise<void> {
  return chrome.storage.local.remove(HINT_KEY);
}

export const watchOnboarding = (onChange: (progress: OnboardingProgress) => void) => watchLocal(PROGRESS_KEY, parseProgress, onChange);

export const watchHostedHint = (onChange: (show: boolean) => void) => watchLocal(HINT_KEY, (value) => value === true, onChange);

/** SW 安裝／更新時一次寫好（background/install.ts）。 */
export function saveInstallState(state: { onboarding: OnboardingProgress; hostedHint: boolean }): Promise<void> {
  return chrome.storage.local.set({ [PROGRESS_KEY]: state.onboarding, [HINT_KEY]: state.hostedHint });
}
