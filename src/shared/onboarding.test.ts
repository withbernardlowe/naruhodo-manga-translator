import { describe, expect, it } from 'vitest';
import { isReauth, onboardingQuery, onboardingRequest, startStep } from './onboarding.ts';

const signedOut = { signedIn: false, consented: false, reauth: false };
const ready = { signedIn: true, consented: true, reauth: false };

describe('onboarding 從哪一步開始', () => {
  it('回到停下來的那一步', () => {
    expect(startStep('intro', signedOut)).toBe('intro');
    expect(startStep('signIn', signedOut)).toBe('signIn');
  });

  it('已經登入：第 2 步直接跳到第 3 步（選擇方案）', () => {
    expect(startStep('signIn', ready)).toBe('plan');
    expect(startStep('plan', ready)).toBe('plan');
  });

  it('停在選擇方案，但登入已經失效：回到第 2 步', () => {
    expect(startStep('plan', signedOut)).toBe('signIn');
  });

  it('還登入著但資料使用說明改版了：只補同意，不重收驗證碼', () => {
    expect(startStep('plan', { signedIn: true, consented: false, reauth: false })).toBe('consent');
  });

  it('「改用內建翻譯」（設定完成、但還在用自備金鑰）：從第 2 步開始，登入了就看方案', () => {
    expect(startStep('done', signedOut, 'signIn')).toBe('signIn');
    expect(startStep('done', ready, 'signIn')).toBe('plan');
  });
});

describe('重新登入：設定早就完成、用內建翻譯', () => {
  it('只有設定完成而且翻譯模式是內建翻譯才算；「改用內建翻譯」的人還要看方案', () => {
    expect(isReauth('done', 'hosted')).toBe(true);
    expect(isReauth('done', 'ownKey')).toBe(false);
    expect(isReauth('plan', 'hosted')).toBe(false);
  });

  it('已經登入了（例如在別的分頁剛登入）：直接到「回到漫畫」，不走選擇方案', () => {
    expect(startStep('done', { ...ready, reauth: true }, 'signIn')).toBe('return');
  });

  it('沒登入還是先登入；只差同意就只補同意', () => {
    expect(startStep('done', { ...signedOut, reauth: true }, 'signIn')).toBe('signIn');
    expect(startStep('done', { signedIn: true, consented: false, reauth: true }, 'consent')).toBe('consent');
  });
});

describe('點圖示時卡住，打開 onboarding 的那一步（#185）', () => {
  it('額度 0：直接到選擇方案；登入已經失效就先登入', () => {
    expect(startStep('done', { ...ready, reauth: true }, 'plan')).toBe('plan');
    expect(startStep('done', { ...signedOut, reauth: true }, 'plan')).toBe('signIn');
  });

  it('自備金鑰沒有 key：直接到「使用自備金鑰」', () => {
    expect(startStep('done', signedOut, 'ownKey')).toBe('ownKey');
  });

  it('補同意：開頁前已經在 side panel 同意了，直接到「回到漫畫」', () => {
    expect(startStep('done', { ...ready, reauth: true }, 'consent')).toBe('return');
  });

  it('網址帶著要跳的步驟與漫畫的分頁', () => {
    expect(onboardingRequest('?step=plan&from=12')).toEqual({ step: 'plan', from: 12 });
    expect(onboardingRequest('?step=signIn')).toEqual({ step: 'signIn' });
    expect(onboardingRequest('?step=consent&from=3')).toEqual({ step: 'consent', from: 3 });
    expect(onboardingRequest('?step=nope&from=x')).toEqual({});
  });

  it('組出來的網址讀得回去', () => {
    expect(onboardingRequest(onboardingQuery('ownKey', 7))).toEqual({ step: 'ownKey', from: 7 });
  });
});
