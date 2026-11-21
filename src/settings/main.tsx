/**
 * 設定頁（#326）：外掛自己的分頁 settings.html，manifest 的 options_ui，從 Chrome 的「選項」與 chrome://extensions 的「擴充功能選項」打開。
 * 不開側邊欄的讀者也能改設定。左側導覽一次只顯示一類（ui/settings-route.ts），內容跟側邊欄 ⚙ 是同一份（settings-sections.tsx）；
 * 帳號與訂閱（原本的 account.html）是「翻譯與帳號」底下的子畫面，上方有麵包屑回到上一層。每一類有自己的 hash，重新整理或從外面帶進來都開到那一類。
 * onboarding 還沒做完時跟側邊欄一樣只有「完成設定」：還沒同意資料使用說明，不能先選好翻譯方式。
 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useHostedQuota, useHostedSession, useTranslationMode } from '../shared/hosted-account-hooks.ts';
import { onboardingUrl, watchOnboarding, type OnboardingProgress } from '../shared/onboarding.ts';
import { Button } from '../ui/components.tsx';
import { FinishSetup } from '../ui/side-panel.tsx';
import { SETTINGS_CATEGORIES, settingsHash, settingsRoute, type SettingsRoute } from '../ui/settings-route.ts';
import { AccountScreen } from './account.tsx';
import { SettingsCategoryContent } from './settings-sections.tsx';

const LOGO = 'icons/naruhodo-small.svg';

/** onboarding 的進度；undefined＝還在讀。 */
function useOnboarding(): OnboardingProgress | undefined {
  const [progress, setProgress] = useState<OnboardingProgress | undefined>(undefined);
  useEffect(() => watchOnboarding(setProgress), []);
  return progress;
}

/** 現在的畫面跟著網址的 hash：切換分類就改 hash（上一頁回得去），Chrome 的「選項」換了 hash 也跟著變。 */
function useRoute(): [SettingsRoute, (next: SettingsRoute) => void] {
  const [route, setRoute] = useState(() => settingsRoute(location.hash));
  useEffect(() => {
    const onHashChange = () => {
      setRoute(settingsRoute(location.hash));
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', onHashChange);
    return () => removeEventListener('hashchange', onHashChange);
  }, []);
  // 只改 hash：?from=N（從漫畫來的「回到漫畫」）留著
  const go = (next: SettingsRoute) => void (location.hash = settingsHash(next));
  return [route, go];
}

const openOnboarding = (step?: 'signIn') => void chrome.tabs.create({ url: onboardingUrl(step) });

function App() {
  const [route, go] = useRoute();
  const onboarding = useOnboarding();
  const mode = useTranslationMode();
  const session = useHostedSession();
  const quota = useHostedQuota(session);
  if (onboarding === undefined || mode === undefined || session === undefined) return null;
  if (onboarding !== 'done')
    return (
      <div class="st-finish">
        <FinishSetup logoSrc={LOGO} onFinishSetup={() => openOnboarding()} />
      </div>
    );
  const category = SETTINGS_CATEGORIES.find(({ id }) => id === route.category)!;
  return (
    <div class="ac st">
      <nav class="st-nav" aria-label="設定分類">
        <p class="st-brand">
          <img src={LOGO} alt="" width={24} height={24} />
          Naruhodo 設定
        </p>
        {SETTINGS_CATEGORIES.map(({ id, label, sub }) => (
          <button
            key={id}
            type="button"
            class="st-nav__item"
            aria-current={id === route.category ? 'page' : undefined}
            onClick={() => go({ category: id, account: false })}
          >
            <span class="st-nav__label">{label}</span>
            <span class="st-nav__sub">{sub}</span>
          </button>
        ))}
      </nav>
      <main class="st-main">
        {route.account ? (
          <>
            <nav class="st-crumb" aria-label="位置">
              <Button variant="link" onClick={() => go({ category: 'translation', account: false })}>
                {category.label}
              </Button>
              <span aria-hidden="true">›</span>
              <span aria-current="page">帳號與訂閱</span>
            </nav>
            <h1 class="ac-h1">帳號與訂閱</h1>
            {/* 不另外當 region：裡面的段落（登入的帳號、目前方案、訂閱…）各自是 region，標題已經在上面 */}
            <div class="ac-card">
              <AccountScreen />
            </div>
          </>
        ) : (
          <>
            <header class="st-head">
              <h1 class="ac-h1">{category.label}</h1>
              <p class="hint">{category.intro}</p>
            </header>
            <section class="ac-card naru-settings" aria-label={category.label}>
              <SettingsCategoryContent
                category={category.id}
                place="page"
                mode={mode}
                session={session}
                quota={quota}
                onSignIn={() => openOnboarding('signIn')}
                onOpenAccount={() => go({ category: 'translation', account: true })}
              />
            </section>
          </>
        )}
      </main>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
