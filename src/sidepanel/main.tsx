import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { grantDataConsent, watchDataConsent, type DataConsent } from '../shared/data-consent.ts';
import type {
  LineRef,
  Message,
  ModelStatus,
  ModelStatusResponse,
  PagesResponse,
  PageView,
  SeriesResponse,
  StatusResponse,
  StripStatus,
} from '../shared/messages.ts';
import { PANEL_PORT } from '../shared/messages.ts';
import { accountUrl } from '../shared/account-page.ts';
import type { SeriesOption } from '../shared/series.ts';
import { useHostedQuota, useHostedSession, useTranslationMode } from '../shared/hosted-account-hooks.ts';
import type { BillingPeriod } from '../shared/hosted-api.ts';
import { dismissHostedHint, onboardingUrl, watchHostedHint, watchOnboarding, type OnboardingProgress } from '../shared/onboarding.ts';
import { dismissSubscribedNotice, watchSubscribedNotice } from '../shared/payment-return.ts';
import { dismissStripNotice, watchStripNoticeSeen } from '../shared/strip-notice.ts';
import {
  DEFAULT_TRANSCRIPT_DISPLAY,
  saveTranscriptDisplay,
  watchTranscriptDisplay,
  type TranscriptDisplay,
} from '../shared/transcript-display.ts';
import { saveTranslationMode } from '../shared/translation-mode.ts';
import { Button } from '../ui/components.tsx';
import { problemReport, type ProblemReportContext } from '../shared/problem-report.ts';
import { PROBLEM_REPORT_URL } from '../ui/links.ts';
import { SidePanel, type SeriesHeader, type SeriesPage } from '../ui/side-panel.tsx';
import { seriesActions, type SeriesAsk } from '../ui/view.ts';
import { PanelSettings, useApiKeySuffix, useDisplaySettings, usePageMode } from '../settings/settings-sections.tsx';
import { ClearCache, DeleteSeries, SeriesNotesSection } from './series-notes.tsx';

/**
 * 點圖示啟動時，SW 用 sidepanel.html?tabId=N 打開這個 tab 專屬的 side panel；Chrome 的「開啟側邊面板」也只在這些 tab 出現（#269）。
 * 沒有 tabId 的只有測試與 debug 工具直接打開的頁面。
 */
function readTabId(): number | undefined {
  const raw = new URLSearchParams(location.search).get('tabId');
  return raw === null ? undefined : Number(raw);
}

const send = <R,>(message: Message) => chrome.runtime.sendMessage<Message, R>(message);

/** 每種翻譯模式的資料使用同意；undefined＝還在讀。 */
function useDataConsent(): DataConsent | undefined {
  const [consent, setConsent] = useState<DataConsent | undefined>(undefined);
  useEffect(() => watchDataConsent(setConsent), []);
  return consent;
}

/** onboarding 的進度；undefined＝還在讀。 */
function useOnboarding(): OnboardingProgress | undefined {
  const [progress, setProgress] = useState<OnboardingProgress | undefined>(undefined);
  useEffect(() => watchOnboarding(setProgress), []);
  return progress;
}

/** 內建翻譯提示還沒關掉（從舊版更新、仍用自備金鑰）。 */
function useHostedHint(): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => watchHostedHint(setShow), []);
  return show;
}

/** 帳號頁發起的付款確認了、還沒按「知道了」（#176）：付款的扣款週期；undefined＝不顯示。 */
function useSubscribedNotice(): BillingPeriod | undefined {
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod | undefined>(undefined);
  useEffect(() => watchSubscribedNotice(setBillingPeriod), []);
  return billingPeriod;
}

/**
 * 用新分頁打開 onboarding（#93）；signIn＝從第 2 步開始，帶著這個 side panel 跟著的漫畫分頁（from）：
 * 設定早就完成的重新登入，登入完直接「回到漫畫」，不走選擇方案與試翻頁。「完成設定」不帶，照常走到第 4 步。
 */
const openOnboarding = (step?: 'signIn') => void chrome.tabs.create({ url: onboardingUrl(step, step ? readTabId() : undefined) });

/** 逐字稿的顯示方式與切換函式；跟 Page Mode 一樣全域記住，別的 side panel 切了也跟著變。 */
function useTranscriptDisplay(): [TranscriptDisplay, (display: TranscriptDisplay) => void] {
  const [display, setDisplay] = useState<TranscriptDisplay>(DEFAULT_TRANSCRIPT_DISPLAY);
  useEffect(() => watchTranscriptDisplay(setDisplay), []);
  const choose = (value: TranscriptDisplay) => {
    setDisplay(value);
    void saveTranscriptDisplay(value);
  };
  return [display, choose];
}

/** 名稱輸入（新增作品／取名字）；送出空白不算。 */
function NameForm({ label, submit, initial = '', onDone }: { label: string; submit: string; initial?: string; onDone: (name: string | undefined) => void }) {
  const [name, setName] = useState(initial);
  return (
    <form
      class="series-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onDone(name.trim());
      }}
    >
      <input aria-label={label} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      <Button variant="primary" type="submit">
        {submit}
      </Button>
      <Button onClick={() => onDone(undefined)}>取消</Button>
    </form>
  );
}

/** 作品頁的「為什麼歸到這部」（#186）。 */
function assignmentReason(assignment: SeriesResponse['assignment']): string | undefined {
  const title = assignment?.originalTitle;
  switch (assignment?.by) {
    case 'urlPattern':
      return '之前在這個網址選過這部作品';
    case 'title':
      return `頁面標題猜到原名「${title}」，跟這部作品相同`;
    case 'created':
      return `頁面標題猜到原名「${title}」，還沒有這部作品，所以新建一部`;
    case 'unnamed':
      return '頁面上看不出作品名稱，所以新建一部未命名作品';
    case 'manual':
      return '你選了這部作品';
    default:
      return undefined;
  }
}

/** 搜尋作品清單：比對名稱、中文譯名與原名（忽略大小寫與全形半形）。 */
const matchesQuery = (option: SeriesOption, query: string) => {
  const q = query.normalize('NFKC').toLowerCase().trim();
  return q === '' || [option.label, option.title, ...(option.originalTitles ?? [])].some((t) => t.normalize('NFKC').toLowerCase().includes(q));
};

/** 這個 tab 目前的 Series 與作品清單；作品歸類、狀態或條目數變了就重讀。標題列與作品頁各自訂閱；tabId 是 undefined＝沒啟動，不讀。 */
function useSeries(tabId: number | undefined): SeriesResponse | undefined {
  const [series, setSeries] = useState<SeriesResponse | undefined>(undefined);
  useEffect(() => {
    if (tabId === undefined) {
      setSeries(undefined);
      return;
    }
    const refresh = () => void send<SeriesResponse>({ type: 'panel:getSeries', tabId }).then(setSeries);
    const onMessage = (message: Message) => {
      if ((message.type === 'series:changed' || message.type === 'status:changed') && message.tabId === tabId) refresh();
      // 條目數會變
      if (message.type === 'notes:changed') refresh();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    refresh();
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [tabId]);
  return series;
}

const currentOption = (series: SeriesResponse | undefined) => series?.options.find((o) => o.id === series.current);

/** Provisional Series 的問句列（#186），作品頁上的那一個（側邊欄主畫面的在提示位置，U14）：猜到原名是［是］［換一部］，猜不出來是［取名字］［選一部］。 */
function AskRow({ tabId, ask, onRename, onPick }: { tabId: number; ask: SeriesAsk; onRename: () => void; onPick: () => void }) {
  return (
    <div class="series-card__ask" role="group" aria-label="確認作品">
      <span class="series-card__question">{ask === 'confirm' ? '這是正確的作品嗎？' : '看不出是哪部作品'}</span>
      {ask === 'confirm' ? (
        <Button variant="primary" onClick={() => void send({ type: 'panel:confirmSeries', tabId })}>
          是
        </Button>
      ) : (
        <Button variant="primary" onClick={onRename}>
          取名字
        </Button>
      )}
      <Button onClick={onPick}>{ask === 'confirm' ? '換一部' : '選一部'}</Button>
    </div>
  );
}

/** 標題列的作品名稱與作品確認（U13、U14；原本的作品卡，#186）：中文譯名、原名，還沒確認時要問什麼。 */
function seriesHeader(series: SeriesResponse | undefined): SeriesHeader | undefined {
  const current = currentOption(series);
  if (!series || !current) return undefined;
  return { title: current.title, subtitle: current.subtitle, ask: seriesActions(current, series.options).ask };
}

/** 條漫計頁的說明按過「知道了」沒（U14）。讀到之前當作看過：看過的讀者打開側邊欄時說明不會閃一下。 */
function useStripNoticeSeen(): boolean {
  const [seen, setSeen] = useState(true);
  useEffect(() => watchStripNoticeSeen(setSeen), []);
  return seen;
}

/**
 * 作品頁（#191）：作品身分（名稱與改名、原名、問句列或「不是這部作品？」）→ 角色與用語 → 最底部清除快取。
 * 從標題列的作品名稱打開，整個取代 side panel。
 */
function SeriesPageView({
  tabId,
  navigate,
  renameOnOpen,
  onRenameOpened,
}: {
  tabId: number;
  navigate: (page: SeriesPage | undefined) => void;
  /** 作品確認的「取名字」：一打開就顯示取名字表單。 */
  renameOnOpen: boolean;
  /** 表單顯示過了：container 清掉 renameOnOpen，之後不管從哪裡回到作品頁都不會再自動打開。 */
  onRenameOpened: () => void;
}) {
  const series = useSeries(tabId);
  const [renaming, setRenaming] = useState(renameOnOpen);
  useEffect(() => {
    if (renameOnOpen) onRenameOpened();
  }, []);
  const current = currentOption(series);
  if (!series || !current) return null;
  const actions = seriesActions(current, series.options);
  const info = [current.provisional ? '自動判斷' : '已確認', `${series.notesCount ?? 0} 個條目`].join(' · ');
  return (
    <>
      <section aria-label="作品身分" class="series-identity">
        {renaming ? (
          <NameForm
            label="作品名稱"
            submit="儲存"
            initial={actions.rename === '取名字' ? '' : current.title}
            onDone={(name) => {
              setRenaming(false);
              if (name) void send({ type: 'panel:renameSeries', tabId, name });
            }}
          />
        ) : (
          <div class="series-identity__row">
            <h2 class="series-identity__name">{current.title}</h2>
            <Button variant="ghost" onClick={() => setRenaming(true)}>
              {actions.rename}
            </Button>
          </div>
        )}
        {current.subtitle && (
          <span class="series-card__original" lang="ja">
            {current.subtitle}
          </span>
        )}
        <span class="series-card__info">{info}</span>
        {actions.ask && <AskRow tabId={tabId} ask={actions.ask} onRename={() => setRenaming(true)} onPick={() => navigate('seriesPick')} />}
        {!actions.ask && (
          <Button variant="link" class="series-identity__pick" onClick={() => navigate('seriesPick')}>
            不是這部作品？
          </Button>
        )}
      </section>
      <SeriesNotesSection tabId={tabId} />
      <div class="series-danger">
        <ClearCache tabId={tabId} />
        <DeleteSeries tabId={tabId} name={current.title} />
      </div>
    </>
  );
}

/**
 * 換一部作品（#191，作品頁再進去的一頁）：為什麼歸到這部、可搜尋的作品清單、新增作品；Provisional 才有「合併進…」。
 * 選好、建好或合併完就回到作品頁（下面的角色與用語換成那一部的）。
 */
function SeriesPickView({ tabId, navigate }: { tabId: number; navigate: (page: SeriesPage | undefined) => void }) {
  const series = useSeries(tabId);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const current = currentOption(series);
  if (!series || !current) return null;
  const { mergeTargets } = seriesActions(current, series.options);
  const reason = assignmentReason(series.assignment);
  const done = () => navigate('series');
  return (
    <section aria-label="換一部作品" class="series-pick">
      {reason && <p class="series-pick__why">{reason}</p>}
      <input aria-label="搜尋作品" placeholder="搜尋作品…" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
      <ul aria-label="作品清單" class="series-pick__list">
        {series.options
          .filter((o) => matchesQuery(o, query))
          .map((o) => (
            <li key={o.id}>
              <button
                type="button"
                class="series-item"
                aria-current={o.id === current.id}
                onClick={() => {
                  if (o.id !== current.id) void send({ type: 'panel:selectSeries', tabId, seriesId: o.id });
                  done();
                }}
              >
                <span class="series-item__text">
                  <span class="series-item__title">{o.title}</span>
                  {o.subtitle && (
                    <span class="series-item__original" lang="ja">
                      {o.subtitle}
                    </span>
                  )}
                </span>
                {o.provisional && <span class="series-item__meta">自動</span>}
              </button>
            </li>
          ))}
      </ul>
      {creating ? (
        <NameForm
          label="新作品名稱"
          submit="建立"
          onDone={(name) => {
            setCreating(false);
            if (!name) return;
            void send({ type: 'panel:createSeries', tabId, name });
            done();
          }}
        />
      ) : (
        <div class="naru-row">
          <Button variant="ghost" onClick={() => setCreating(true)}>
            ＋ 新增作品…
          </Button>
        </div>
      )}
      {mergeTargets.length > 0 && (
        <form
          class="series-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mergeTarget) return;
            void send({ type: 'panel:mergeSeries', tabId, targetId: mergeTarget });
            done();
          }}
        >
          <select aria-label="合併進" value={mergeTarget} onChange={(e) => setMergeTarget(e.currentTarget.value)}>
            <option value="">合併進…</option>
            {mergeTargets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
          <Button type="submit">合併</Button>
        </form>
      )}
    </section>
  );
}

/** 到 content script 的 port 被對方斷了之後，等這麼久（ms）再接（U10）。 */
const PANEL_PORT_RETRY_MS = 1000;

/**
 * 外掛的 container（#108）：接 chrome 訊息、API key、同意狀態與 Page Mode 的 store，把資料交給純畫面的 SidePanel。
 * 會讀寫 store 的區塊（設定頁、作品頁與換一部作品）也在這裡，以 slot／render prop 交給 SidePanel。
 * 沒做完 onboarding（#93）時 SidePanel 只顯示「完成設定」；「登入」「完成設定」用新分頁打開 onboarding。
 */
function App({ tabId }: { tabId: number | undefined }) {
  // undefined＝還在問 SW
  const [active, setActive] = useState<boolean | undefined>(tabId === undefined ? false : undefined);
  const [pages, setPages] = useState<PageView[]>([]);
  const [strip, setStrip] = useState<StripStatus | undefined>(undefined);
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ state: 'idle' });
  // 讀到之前當作有 key：有 key 的讀者打開側邊欄時「尚未設定 API key」不會閃一下
  const keySuffix = useApiKeySuffix();
  const hasKey = keySuffix !== '';
  const [pageMode, choosePageMode] = usePageMode();
  const [transcriptDisplay, chooseTranscriptDisplay] = useTranscriptDisplay();
  const [displaySettings] = useDisplaySettings();
  const [hovered, setHovered] = useState<LineRef | undefined>(undefined);
  const consent = useDataConsent();
  const translationMode = useTranslationMode();
  const session = useHostedSession();
  const quota = useHostedQuota(session);
  const onboarding = useOnboarding();
  const hostedHint = useHostedHint();
  const subscribedNotice = useSubscribedNotice();
  const stripNoticeSeen = useStripNoticeSeen();
  const series = useSeries(active ? tabId : undefined);
  /** 作品確認的「取名字」：打開作品頁時直接顯示取名字表單（#191）。 */
  const [renameOnOpen, setRenameOnOpen] = useState(false);
  /** 這個 tab 的作品剛被刪掉（#214，不管是在哪個 side panel 刪的）：停用的畫面顯示「這部作品已刪除」，再啟動就不再顯示。 */
  const [seriesDeleted, setSeriesDeleted] = useState(false);

  useEffect(() => {
    if (tabId === undefined) return;
    const onMessage = (message: Message, sender: chrome.runtime.MessageSender) => {
      if (message.type === 'content:hover' && sender.tab?.id === tabId)
        setHovered(message.line ?? undefined);
      if (message.type === 'status:changed' && message.tabId === tabId) {
        setActive(message.active);
        if (message.active) setSeriesDeleted(false);
      }
      if (message.type === 'series:deleted' && message.tabIds.includes(tabId)) setSeriesDeleted(true);
      if (message.type === 'pages:updated' && message.tabId === tabId) {
        setPages(message.pages);
        setStrip(message.strip);
      }
      if (message.type === 'models:status') setModelStatus(message.status);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    void send<StatusResponse>({ type: 'panel:getStatus', tabId }).then((r) => setActive(r.active));
    void send<PagesResponse>({ type: 'panel:getPages', tabId }).then((r) => {
      setPages(r.pages);
      setStrip(r.strip);
    });
    void send<ModelStatusResponse>({ type: 'panel:getModelStatus' }).then((r) => setModelStatus(r.status));
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [tabId]);

  // 讓頁面知道側邊欄開著（U10）：接一條 port 到這個分頁的 content script，關掉側邊欄時自動斷。
  // 有 Page 才接：那時 content script 一定在跑；重新整理後 pages 先清空再回來，會重接
  const hasPages = pages.length > 0;
  const [portRetry, setPortRetry] = useState(0);
  useEffect(() => {
    if (tabId === undefined || !active || !hasPages) return;
    const port = chrome.tabs.connect(tabId, { name: PANEL_PORT });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 對方斷的（content script 被重新注入、頁面重新整理）：過一下再接。停止翻譯時 active 變 false，不會再接
    port.onDisconnect.addListener(() => {
      // 讀掉 lastError：content script 不在時 port 立刻斷，不要在 console 留 Unchecked runtime.lastError
      void chrome.runtime.lastError;
      timer = setTimeout(() => setPortRetry((n) => n + 1), PANEL_PORT_RETRY_MS);
    });
    // 自己斷的不會觸發自己的 onDisconnect
    return () => {
      clearTimeout(timer);
      port.disconnect();
    };
  }, [tabId, active, hasPages, portRetry]);

  if (active === undefined || translationMode === undefined || session === undefined || onboarding === undefined) return null;
  const running = active && tabId !== undefined;
  // 停止、擷取、翻譯、逐字稿 hover 只在 running（有 tabId）時出現，所以 tabId! 是安全的
  return (
    <SidePanel
      running={running}
      seriesDeleted={!running && seriesDeleted}
      pages={pages}
      modelStatus={modelStatus}
      access={translationMode === 'hosted' ? { mode: 'hosted', signedIn: session !== null } : { mode: 'ownKey', hasKey }}
      consent={consent?.[translationMode]}
      pageMode={pageMode}
      hovered={hovered}
      logoSrc="icons/naruhodo-small.svg"
      onPageModeChange={choosePageMode}
      transcriptDisplay={transcriptDisplay}
      onTranscriptDisplayChange={chooseTranscriptDisplay}
      displaySettings={displaySettings}
      onScan={() => void send({ type: 'panel:scan', tabId: tabId! })}
      onTranslate={(pageHash) => void send({ type: 'panel:translate', tabId: tabId!, ...(pageHash === undefined ? {} : { pageHash }) })}
      onRetranslate={() => void send({ type: 'panel:retranslate', tabId: tabId! })}
      onStop={() => void send({ type: 'panel:stop', tabId: tabId! })}
      onLineHover={(line) => {
        chrome.tabs.sendMessage(tabId!, { type: 'content:highlight', line } satisfies Message).catch(() => {});
      }}
      // 自備金鑰沒同意、或內建翻譯還登入著但說明改版時出現；同意後已啟動的分頁由 SW 直接開始翻譯
      onAcceptConsent={() => void grantDataConsent(translationMode)}
      onUseOwnKey={() => void saveTranslationMode('ownKey')}
      onSignIn={() => openOnboarding('signIn')}
      setupComplete={onboarding === 'done'}
      onFinishSetup={() => openOnboarding()}
      hostedHint={hostedHint}
      onDismissHostedHint={() => void dismissHostedHint()}
      quota={translationMode === 'hosted' ? quota : undefined}
      strip={strip}
      // 跟 Page 上的紅色標籤一樣帶著漫畫分頁打開帳號頁：付完款按「回到漫畫」接著翻
      onViewPlans={() => void chrome.tabs.create({ url: accountUrl(tabId) })}
      subscribedNotice={subscribedNotice}
      onDismissSubscribedNotice={() => void dismissSubscribedNotice()}
      reportProblem={
        tabId === undefined
          ? undefined
          : {
              // 每次按都重新讀：讀者可能翻了頁、重新翻譯過
              async copy() {
                const context = await send<ProblemReportContext>({ type: 'panel:problemReport', tabId });
                const report = problemReport({
                  extensionVersion: chrome.runtime.getManifest().version,
                  userAgent: navigator.userAgent,
                  translationMode,
                  pageMode,
                  displaySettings,
                  modelStatus,
                  pages,
                  context,
                });
                await navigator.clipboard.writeText(report);
              },
              open: () => void chrome.tabs.create({ url: PROBLEM_REPORT_URL }),
            }
      }
      stripNoticeSeen={stripNoticeSeen}
      onDismissStripNotice={() => void dismissStripNotice()}
      series={seriesHeader(series)}
      onConfirmSeries={() => void send({ type: 'panel:confirmSeries', tabId: tabId! })}
      onOpenSeries={({ rename }) => setRenameOnOpen(rename)}
      renderSettings={() => (
        <PanelSettings
          mode={translationMode}
          session={session}
          quota={quota}
          onSignIn={() => openOnboarding('signIn')}
          // 方案與退款太寬，不塞進側邊欄：用新分頁打開設定頁的帳號與訂閱
          onOpenAccount={() => void chrome.tabs.create({ url: accountUrl() })}
        />
      )}
      renderSeries={(page, navigate) => {
        if (tabId === undefined) return null;
        if (page === 'seriesPick') return <SeriesPickView tabId={tabId} navigate={navigate} />;
        return <SeriesPageView tabId={tabId} navigate={navigate} renameOnOpen={renameOnOpen} onRenameOpened={() => setRenameOnOpen(false)} />;
      }}
    />
  );
}

render(<App tabId={readTabId()} />, document.getElementById('app')!);
