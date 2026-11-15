/**
 * 卡住時要解決的那一步：signIn＝side panel 的「登入」「改用內建翻譯」、點圖示時沒登入（onboarding）；
 * consent＝還登入著、只是資料使用說明改版了（onboarding 的補同意畫面，不用重收驗證碼）；plan＝額度 0（帳號頁，#213）；
 * ownKey＝點圖示時自備金鑰沒有 key 或沒同意（#185）。單獨一個檔案、不碰 chrome.*：Page 上的狀態（page-status.ts）經過 messages.ts
 * 也會被 Worker 的 typecheck 讀到。
 */
export type RequestedStep = 'signIn' | 'consent' | 'plan' | 'ownKey';

/** 內建翻譯卡在哪：沒登入是登入（同意在登入時一起取得）；還登入著、只是沒同意目前版本的說明就只補同意（GLOSSARY 的 Data Use Consent）。 */
export function hostedBlockedStep({ signedIn, consented }: { signedIn: boolean; consented: boolean }): 'signIn' | 'consent' | undefined {
  if (!signedIn) return 'signIn';
  return consented ? undefined : 'consent';
}
