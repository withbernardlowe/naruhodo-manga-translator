import { describe, expect, it } from 'vitest';
import { hostedBlockedStep } from './onboarding-step.ts';

describe('內建翻譯卡在哪一步（點圖示、Page 上的紅標籤）', () => {
  it('沒登入：登入（同意在登入時一起取得）', () => {
    expect(hostedBlockedStep({ signedIn: false, consented: false })).toBe('signIn');
    expect(hostedBlockedStep({ signedIn: false, consented: true })).toBe('signIn');
  });

  it('還登入著、只是沒同意（資料使用說明改版了）：只補同意，不用重收驗證碼', () => {
    expect(hostedBlockedStep({ signedIn: true, consented: false })).toBe('consent');
  });

  it('登入而且同意了：沒卡住', () => {
    expect(hostedBlockedStep({ signedIn: true, consented: true })).toBeUndefined();
  });
});
