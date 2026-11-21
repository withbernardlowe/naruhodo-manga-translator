/**
 * 設定的內容（#326）：設定頁（settings.html）與側邊欄 ⚙ 共用這一份，分類名稱、順序與開關都一樣（ui/settings-route.ts）。
 * 差別只有排法：設定頁一次顯示一類（左側導覽在 settings/main.tsx），側邊欄寬度不夠，三類由上往下排成三個小標；
 * 側邊欄不放頁面模式（主畫面本來就有「漫畫頁面」那一列）。
 * 這裡會讀寫 store、送 chrome 訊息，所以放在外掛這一側，不在純畫面的 src/ui/。兩邊都聽同一份 storage（watch*），一邊改了另一邊立刻跟著變；
 * API key 在 IndexedDB，改了用 apiKey:changed 通知其他頁面。樣式在 src/ui/settings.css，以 .naru-settings 為範圍。
 */
import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { BackupFile } from '../background/backup.ts';
import { indexedDbApiKeyStore, lastFour } from '../shared/api-key-store.ts';
import { DEFAULT_DISPLAY_SETTINGS, saveDisplaySettings, watchDisplaySettings, type DisplaySettings } from '../shared/display-settings.ts';
import type { Quota } from '../shared/hosted-api.ts';
import type { HostedSession } from '../shared/hosted-session.ts';
import type { ImportResponse, Message, TestConnectionResponse } from '../shared/messages.ts';
import { DEFAULT_PAGE_MODE, savePageMode, watchPageMode, type PageMode } from '../shared/page-mode.ts';
import { DEFAULT_SIDE_PANEL_ON_ACTIVATION, saveSidePanelOnActivation, watchSidePanelOnActivation } from '../shared/side-panel-setting.ts';
import { saveTranslationMode, type TranslationMode } from '../shared/translation-mode.ts';
import { Badge, Button, RadioCard, SegmentedControl, Switch } from '../ui/components.tsx';
import { CONTACT_EMAIL, DISCUSSIONS_URL } from '../ui/links.ts';
import { PAGE_MODES } from '../ui/side-panel.tsx';
import { SETTINGS_CATEGORIES, type SettingsCategory } from '../ui/settings-route.ts';
import { accountPlanView } from '../ui/view.ts';

const send = <R,>(message: Message) => chrome.runtime.sendMessage<Message, R>(message);

const apiKeys = indexedDbApiKeyStore();

/** 設定頁（page）或側邊欄 ⚙（panel）。 */
export type SettingsPlace = 'page' | 'panel';

/** 這一頁自己改了 key：runtime 訊息不會送回給發送的一方，自己的 useApiKeySuffix 另外通知。 */
const keyChangedHere = new EventTarget();

function broadcastApiKeyChanged(): void {
  keyChangedHere.dispatchEvent(new Event('change'));
  void send({ type: 'apiKey:changed' }).catch(() => {});
}

/** 已存的 Claude API key 的末四碼；''＝沒有 key，undefined＝還在讀。別的頁面（設定頁、側邊欄）改了也跟著變。 */
export function useApiKeySuffix(): string | undefined {
  const [suffix, setSuffix] = useState<string | undefined>(undefined);
  useEffect(() => {
    const refresh = () => void apiKeys.get().then((key) => setSuffix(key ? lastFour(key) : ''));
    const onMessage = (message: Message) => {
      if (message.type === 'apiKey:changed') refresh();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    keyChangedHere.addEventListener('change', refresh);
    refresh();
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      keyChangedHere.removeEventListener('change', refresh);
    };
  }, []);
  return suffix;
}

/** 「顯示」的兩個開關（shared/display-settings.ts）；逐字稿與 Problem Report 也讀它。 */
export function useDisplaySettings(): [DisplaySettings, (next: DisplaySettings) => void] {
  const [settings, setSettings] = useState(DEFAULT_DISPLAY_SETTINGS);
  useEffect(() => watchDisplaySettings(setSettings), []);
  const choose = (next: DisplaySettings) => {
    setSettings(next);
    void saveDisplaySettings(next);
  };
  return [settings, choose];
}

/** 目前的 Page Mode 與切換函式；別的頁面（側邊欄、設定頁、右鍵選單）切了也跟著變。 */
export function usePageMode(): [PageMode, (mode: PageMode) => void] {
  const [mode, setMode] = useState<PageMode>(DEFAULT_PAGE_MODE);
  useEffect(() => watchPageMode(setMode), []);
  const choose = (value: PageMode) => {
    setMode(value);
    void savePageMode(value);
  };
  return [mode, choose];
}

/**
 * 匯出／匯入 JSON（#38）：全部 Series、網址模式、Series Notes、翻譯快取，給兩台電腦之間搬資料；不含 API key。
 * 匯入是合併、本機優先。
 */
function Backup() {
  const [result, setResult] = useState<string | undefined>(undefined);

  async function exportFile() {
    const data = await send<BackupFile>({ type: 'panel:export' });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `naruhodo-${new Date(data.exportedAt).toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File) {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setResult('匯入失敗：不是 JSON 檔');
      return;
    }
    const r = await send<ImportResponse>({ type: 'panel:import', data });
    setResult(r.ok ? '匯入完成' : `匯入失敗：${r.error}`);
  }

  return (
    <div class="backup">
      <Button onClick={() => void exportFile()}>匯出 JSON</Button>
      {/* 跟「匯出 JSON」一樣的按鈕：原生的選檔按鈕藏起來（仍可聚焦、讀屏念得到），點 label 就打開選檔 */}
      <label class="naru-btn naru-btn--secondary backup__import">
        匯入 JSON
        <input
          type="file"
          class="backup__file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) void importFile(file);
            e.currentTarget.value = '';
          }}
        />
      </label>
      {result && <p role="status">{result}</p>}
    </div>
  );
}

/**
 * 「內建翻譯」卡片裡的帳號摘要（#213）：已登入時是 email＋方案 Badge、剩餘說明與「管理帳號與訂閱」（訂閱、退款、登出、刪除帳號都在那裡）；
 * 沒登入時是「登入」，打開 onboarding 的第 2 步。
 * 設定頁的「管理帳號與訂閱 →」換到同一頁的子畫面；側邊欄的「↗」用新分頁打開設定頁的 #account，方案與退款不塞進側邊欄。
 */
function HostedAccount({
  place,
  session,
  quota,
  onSignIn,
  onOpenAccount,
}: {
  place: SettingsPlace;
  session: HostedSession | null;
  quota: Quota | undefined;
  onSignIn: () => void;
  onOpenAccount: () => void;
}) {
  if (!session)
    return (
      <>
        <p>尚未登入。</p>
        <Button variant="primary" onClick={onSignIn}>
          登入
        </Button>
      </>
    );
  const plan = quota && accountPlanView(quota);
  return (
    <>
      <p class="naru-row">
        {session.email}
        {plan && <Badge tone={plan.badge.tone}>{plan.badge.text}</Badge>}
      </p>
      {plan && (
        <p class="hint">
          {plan.lines.map((line, i) => (
            <Fragment key={line}>
              {i > 0 && <br />}
              {line}
            </Fragment>
          ))}
        </p>
      )}
      <div class="actions">
        <Button variant="link" onClick={onOpenAccount}>
          {place === 'page' ? '管理帳號與訂閱 →' : '管理帳號與訂閱 ↗'}
        </Button>
      </div>
    </>
  );
}

/**
 * 「自備金鑰」卡片展開的內容（spec #27 第 5 節）：API key 存在外掛 origin 的 IndexedDB，只顯示末四碼。
 * 頁面自己讀寫 key；「測試連線」由 offscreen 讀 key 呼叫 API，訊息裡不帶 key。
 */
function OwnKey() {
  const suffix = useApiKeySuffix();
  const [draft, setDraft] = useState('');
  const [connection, setConnection] = useState<string | undefined>(undefined);

  async function save() {
    const key = draft.trim();
    if (!key) return;
    await apiKeys.set(key);
    setDraft('');
    setConnection(undefined);
    broadcastApiKeyChanged();
  }

  async function remove() {
    await apiKeys.delete();
    setConnection(undefined);
    broadcastApiKeyChanged();
  }

  async function test() {
    setConnection('測試中…');
    const r = await send<TestConnectionResponse>({ type: 'panel:testConnection' });
    setConnection(r.ok ? `連線成功（${r.model}）` : `連線失敗：${r.error}`);
  }

  return (
    <>
      {suffix === undefined ? null : suffix ? (
        <>
          <p>已設定 Claude API key（末四碼 {suffix}）</p>
          <div class="actions">
            <Button onClick={() => void test()}>測試連線</Button>
            <Button onClick={() => void remove()}>刪除</Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Claude API key
            <input
              type="password"
              autocomplete="off"
              spellcheck={false}
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            />
          </label>
          <Button variant="primary" type="submit">
            儲存
          </Button>
        </form>
      )}
      {connection && <p class="connection">{connection}</p>}
      <p class="hint">
        建議在 Anthropic Console 為這個外掛建立專用的 API key，並為它的 workspace 設定花費上限。key 只存在這台電腦的外掛裡，不會交給網頁，也不會出現在匯出檔。
      </p>
    </>
  );
}

/** 設定頁的小標（漫畫頁面、側邊欄…）；側邊欄的分類本身已經是小標，裡面不再分。 */
function Sub({ place, children }: { place: SettingsPlace; children: string }) {
  return place === 'page' ? <h2 class="naru-settings__sub">{children}</h2> : null;
}

export interface TranslationSettingsProps {
  mode: TranslationMode;
  session: HostedSession | null;
  quota: Quota | undefined;
  /** 「登入」：打開 onboarding 的第 2 步。 */
  onSignIn: () => void;
  /** 「管理帳號與訂閱」：設定頁換到子畫面，側邊欄用新分頁打開 settings.html#account。 */
  onOpenAccount: () => void;
}

/** 翻譯與帳號：翻譯方式是明確的二選一（不會自動切換；切到自備金鑰不會登出）。 */
function TranslationSettings({ place, mode, session, quota, onSignIn, onOpenAccount }: TranslationSettingsProps & { place: SettingsPlace }) {
  const account = <HostedAccount place={place} session={session} quota={quota} onSignIn={onSignIn} onOpenAccount={onOpenAccount} />;
  return (
    <>
      <Sub place={place}>翻譯方式</Sub>
      <div role="radiogroup" aria-label="翻譯方式" class="mode-cards">
        <RadioCard
          name="translation-mode"
          title="內建翻譯"
          description="用 email 帳號，Naruhodo 代為翻譯，有頁數限制"
          checked={mode === 'hosted'}
          onSelect={() => void saveTranslationMode('hosted')}
        >
          {account}
        </RadioCard>
        <RadioCard
          name="translation-mode"
          title="自備金鑰"
          description="用你自己的 Anthropic API key，費用直接付給 Anthropic，沒有頁數限制"
          checked={mode === 'ownKey'}
          onSelect={() => void saveTranslationMode('ownKey')}
        >
          <OwnKey />
        </RadioCard>
      </div>
      {mode === 'ownKey' && session && (
        // 自備金鑰時內建翻譯的卡片收著：還登入著的帳號另外列出來，才找得到「管理帳號與訂閱」與登出（#213）
        <>
          {place === 'page' ? <h2 class="naru-settings__sub">帳號</h2> : <h3 class="naru-settings__sub">帳號</h3>}
          <div class="naru-radio-card">{account}</div>
          <p class="hint">目前用自備金鑰翻譯，不會用到這個帳號的頁數；切回內建翻譯就能接著用。</p>
        </>
      )}
    </>
  );
}

/** 「點圖示時也打開側邊欄」（Side Panel on Activation，#269）。 */
function SidePanelOnActivation() {
  const [open, setOpen] = useState(DEFAULT_SIDE_PANEL_ON_ACTIVATION);
  useEffect(() => watchSidePanelOnActivation(setOpen), []);
  return (
    <Switch
      label="點圖示時也打開側邊欄"
      description="只想看漫畫就關掉；逐字稿、角色與用語還是可以從 Chrome 的「開啟側邊面板」打開。"
      checked={open}
      onChange={(checked) => {
        setOpen(checked);
        void saveSidePanelOnActivation(checked);
      }}
    />
  );
}

/** 頁面模式（Page Mode）：只在設定頁；側邊欄的主畫面本來就有「漫畫頁面」那一列。 */
function PageModeRow() {
  const [mode, choose] = usePageMode();
  return (
    <div class="naru-settings__row">
      <span class="naru-settings__row-text">
        <span class="naru-switch__label">頁面模式</span>
        <span class="naru-switch__desc">閱讀：漫畫頁面直接顯示中文。學習：保留日文，游標移到對話框上看讀音。也可以從圖示的右鍵選單切換。</span>
      </span>
      <SegmentedControl label="頁面模式" options={PAGE_MODES} value={mode} onChange={choose} />
    </div>
  );
}

/** 閱讀與顯示：漫畫頁面（頁面模式、學習模式直接顯示譯文、羅馬拼音）與側邊欄。 */
function DisplaySettingsSection({ place }: { place: SettingsPlace }) {
  const [settings, choose] = useDisplaySettings();
  return (
    <>
      <Sub place={place}>漫畫頁面</Sub>
      <div class="naru-settings__switches">
        {place === 'page' && <PageModeRow />}
        <Switch
          label="學習模式直接顯示譯文"
          description="學習模式下，tooltip 與逐字稿的譯文不用先把游標移到譯文區塊上就看得到。漫畫頁面一樣只留日文原文。"
          checked={settings.learnShowsTranslation}
          onChange={(checked) => choose({ ...settings, learnShowsTranslation: checked })}
        />
        <Switch
          label="讀音加上羅馬拼音"
          description="有顯示讀音的地方，原文下面多一行羅馬拼音，例如 kinō wa rāmen o tabemashita。"
          checked={settings.romaji}
          onChange={(checked) => choose({ ...settings, romaji: checked })}
        />
      </div>
      <Sub place={place}>側邊欄</Sub>
      <div class="naru-settings__switches">
        <SidePanelOnActivation />
      </div>
    </>
  );
}

/** 資料與回饋：匯出／匯入、到討論區回報。 */
function DataSettings({ place }: { place: SettingsPlace }) {
  return (
    <>
      <Sub place={place}>匯出與匯入</Sub>
      <p class="hint">在兩台電腦之間搬作品、角色與用語與翻譯快取（不含 API key 與帳號）。</p>
      <Backup />
      <Sub place={place}>意見回饋</Sub>
      <p class="hint">翻不出來、譯文位置跑掉，或有想要的功能，歡迎到討論區告訴我們。</p>
      <div class="actions">
        <a class="naru-btn naru-btn--secondary" href={DISCUSSIONS_URL} target="_blank" rel="noreferrer">
          到討論區回報
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M4.5 2.5h5v5" />
            <path d="M9.5 2.5 3 9" />
          </svg>
        </a>
      </div>
      <p class="hint">
        帳號或付款的問題請寄 <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>，不要貼在公開的討論區。
      </p>
    </>
  );
}

/** 一類設定的內容。 */
export function SettingsCategoryContent({ category, place, ...translation }: { category: SettingsCategory; place: SettingsPlace } & TranslationSettingsProps) {
  switch (category) {
    case 'translation':
      return <TranslationSettings place={place} {...translation} />;
    case 'display':
      return <DisplaySettingsSection place={place} />;
    case 'data':
      return <DataSettings place={place} />;
  }
}

/** 側邊欄 ⚙ 的設定：三類由上往下，分類名稱當小標（跟設定頁左側導覽同一份名稱與順序）。 */
export function PanelSettings(props: TranslationSettingsProps) {
  return (
    <section aria-label="設定" class="naru-settings naru-settings--panel">
      {SETTINGS_CATEGORIES.map(({ id, label }) => (
        <section key={id} aria-label={label} class="naru-settings__category">
          <h2 class="naru-settings__category-title">{label}</h2>
          <SettingsCategoryContent category={id} place="panel" {...props} />
        </section>
      ))}
    </section>
  );
}
