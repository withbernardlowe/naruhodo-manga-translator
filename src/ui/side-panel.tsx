/**
 * side panel 的純畫面（#108）：只吃「現在要顯示什麼」與一組 callback，不碰 chrome.*、IndexedDB 或任何 store，
 * 外掛（src/sidepanel/main.tsx 的 container）與產品網站都 render 這一個。樣式在 side-panel.css，
 * 全部以根元素 .naru-side-panel 為範圍，放進 shadow root（再載入 tokens.css、components.css）就完整。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useState } from 'preact/hooks';
import { FREE_PAGES, pageCount, type BillingPeriod, type Quota } from '../shared/hosted-api.ts';
import type { LineRef, ModelStatus, PageView, StripStatus } from '../shared/messages.ts';
import { megabytes } from '../shared/model-download.ts';
import type { PageMode } from '../shared/page-mode.ts';
import { loadPunctuationFont } from '../shared/punctuation-face.ts';
import type { StaleReason } from '../shared/series-notes.ts';
import { currentDisplay, type Display, type TranscriptDisplay } from '../shared/transcript-display.ts';
import type { TranslationMode } from '../shared/translation-mode.ts';
import { Badge, Button, Callout, PageHeader, Progress, SegmentedControl, type SegmentOption } from './components.tsx';
import type { ConsentState } from '../shared/data-consent.ts';
import { ConsentDisclosure } from './data-flow.tsx';
import { PRIVACY_URL } from './links.ts';
import { SubscriptionPrice } from './subscribe-button.tsx';
import { Transcript, TranscriptHeading } from './transcript.tsx';
import {
  canTranslate,
  chargeNote,
  hasUntranslated,
  panelLayout,
  quotaView,
  stripView,
  setupNotices,
  parentPage,
  sidePanelScreen,
  sidePanelView,
  subscribedNoticeText,
  type EndView,
  type FooterView,
  type PanelPage,
  type PageEntry,
  type QuotaLineView,
  type QuotaView,
  type ConsentCard,
  type SetupNotice,
  type TranslationAccess,
} from './view.ts';

function ModelStatusLine({ status, onRetry }: { status: ModelStatus; onRetry: () => void }) {
  switch (status.state) {
    case 'downloading':
      return (
        <p role="status">
          第一次使用，下載辨識模型中：{megabytes(status.loaded)} / {megabytes(status.total)} MB
          <progress value={status.loaded} max={status.total} />
        </p>
      );
    case 'loading':
      return <p role="status">載入辨識模型中…</p>;
    case 'error':
      return (
        <Callout tone="danger" role="alert">
          <p>辨識模型無法使用：{status.message}</p>
          <Button onClick={onRetry}>重試</Button>
        </Callout>
      );
    default:
      return null;
  }
}

/** 逐字稿的共用狀態：依 Page Mode 的顯示方式（#76）與 hover 同步（#39）。 */
interface TranscriptSync {
  display: Display;
  /** 頁面上滑鼠所在的那句。 */
  hovered: LineRef | undefined;
  /** 滑過 panel 的某行 → 頁面上那句高亮；null＝離開。 */
  onLineHover: (line: LineRef | null) => void;
}

const STALE_TEXT: Record<StaleReason, string> = {
  notes: '角色與用語已更新，這頁是更新前翻的',
  version: '翻譯模型或 prompt 已更新，這頁是用舊版翻的',
};

/** 重翻要花什麼（view.ts 的 chargeNote）。 */
type Charge = ReturnType<typeof chargeNote>;

/** 「重新翻譯」＋按鈕下面扣多少的小字（不另外確認，按鈕放置方案）；disabled＝額度不夠。 */
function RetranslateButton({
  variant,
  note,
  disabled,
  onClick,
}: {
  variant: 'secondary' | 'ghost';
  note: string | undefined;
  disabled: boolean;
  onClick: () => void;
}) {
  const noteId = useId();
  return (
    <>
      <Button variant={variant} onClick={onClick} disabled={disabled} aria-describedby={note && noteId}>
        重新翻譯
      </Button>
      {note && (
        <small id={noteId} class="charge-note">
          {note}
        </small>
      )}
    </>
  );
}

/** 過時只提示、不自動重翻（spec #27 第 4.3 節）；按「重新翻譯」只重翻這一頁。 */
function StaleHint({ reason, charge, onRetranslate }: { reason: StaleReason; charge: Charge; onRetranslate: () => void }) {
  return (
    <Callout tone="warn" role="group" aria-label="過時提示">
      <span>{STALE_TEXT[reason]}</span>
      <RetranslateButton variant="secondary" note={charge?.text} disabled={charge?.enough === false} onClick={onRetranslate} />
    </Callout>
  );
}

function PageItem({
  entry: { page, side, heading, translationStatus },
  onRetry,
  onRetranslate,
  staleCharge,
  sync,
}: {
  entry: PageEntry;
  onRetry: () => void;
  onRetranslate: () => void;
  staleCharge: Charge;
  sync: TranscriptSync;
}) {
  const { transcript } = page;
  const { display, hovered, onLineHover } = sync;
  const headingId = useId();
  return (
    <li aria-labelledby={headingId}>
      <PageHeader
        id={headingId}
        side={side}
        heading={heading}
        status={
          translationStatus && (
            <p class="translation-status" role="status" aria-label="翻譯狀態">
              {translationStatus}
            </p>
          )
        }
      />
      {transcript.state === 'analyzing' && <Progress>辨識中…</Progress>}
      {transcript.state === 'error' && <Callout tone="danger">辨識失敗：{transcript.message}</Callout>}
      {transcript.state === 'done' && transcript.stale && !transcript.translating && (
        <StaleHint reason={transcript.stale} charge={staleCharge} onRetranslate={onRetranslate} />
      )}
      {transcript.state === 'done' && transcript.translating && <Progress>翻譯中…</Progress>}
      {transcript.state === 'done' && transcript.translateError && (
        <Callout tone="danger" role="alert">
          <p>翻譯失敗，改顯示 kuromoji 讀音：{transcript.translateError}</p>
          <Button onClick={onRetry}>重試</Button>
        </Callout>
      )}
      {transcript.state === 'done' && (
        <Transcript
          text={transcript.text}
          translated={transcript.translated}
          display={display}
          hoveredId={hovered?.pageHash === page.pageHash ? hovered.lineId : undefined}
          onHover={(lineId) => onLineHover(lineId === null ? null : { pageHash: page.pageHash, lineId })}
        />
      )}
    </li>
  );
}

/**
 * 資料使用說明卡（shared/data-consent.ts）：目前翻譯模式還沒同意就固定顯示在最上面，啟動前、從內建選單打開時都一樣。
 * 自備金鑰沒同意過、或兩種模式的說明改版時出現；內建翻譯還登入著的讀者在這裡補同意，不用重新登入。
 * 內容跟 onboarding 的補同意畫面共用（data-flow.tsx）。按了「同意並啟用翻譯」，已啟動的分頁直接開始翻譯（SW）。
 */
function DataConsentCard({ mode, card, onAccept }: { mode: TranslationMode; card: Exclude<ConsentCard, undefined>; onAccept: () => void }) {
  return (
    <section aria-label="資料使用說明">
      <Callout tone="warn">
        <ConsentDisclosure mode={mode} updated={card === 'updated'} />
        <p>
          詳見
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
            隱私權政策
          </a>
          。不同意也能使用，只會顯示原文與讀音。
        </p>
        <Button variant="primary" onClick={onAccept}>
          同意並啟用翻譯
        </Button>
      </Callout>
    </section>
  );
}

/**
 * 逐字稿上方的設定提示（view.ts 的 setupNotices 決定顯示哪一個）。「尚未登入」的版面與文案照 #91 畫面定案、
 * 內建翻譯提示照 #93：「登入」「改用內建翻譯」打開 onboarding 的第 2 步，「使用自備金鑰」打開設定頁。
 */
function SetupNoticeCallout({
  notice,
  onSignIn,
  onUseOwnKey,
  onDismissHostedHint,
}: {
  notice: SetupNotice;
  onSignIn: () => void;
  onUseOwnKey: () => void;
  onDismissHostedHint: () => void;
}) {
  if (notice === 'noKey')
    return <Callout tone="warn">尚未設定 API key：只顯示原文與讀音（kuromoji 推測），未翻譯。請按右上角的 ⚙ 打開設定，輸入 key。</Callout>;
  if (notice === 'hostedHint')
    return (
      <Callout class="naru-callout--stack" role="group" aria-label="內建翻譯提示">
        <p>現在也可以改用內建翻譯：用 email 登入就能翻，不用自備 API key。新帳號有 {FREE_PAGES} 頁免費額度。</p>
        <div class="naru-row">
          {/* 按任何一個都算關掉，不再出現 */}
          <Button
            onClick={() => {
              onDismissHostedHint();
              onSignIn();
            }}
          >
            改用內建翻譯
          </Button>
          <Button variant="ghost" onClick={onDismissHostedHint}>
            不用了
          </Button>
        </div>
      </Callout>
    );
  if (notice !== 'signedOut') return null;
  return (
    <Callout tone="warn" class="naru-callout--stack" role="group" aria-label="尚未登入">
      <p>
        <strong>尚未登入</strong>：只顯示原文與讀音。
      </p>
      <div class="naru-row">
        <Button variant="primary" onClick={onSignIn}>
          登入
        </Button>
        <Button variant="link" onClick={onUseOwnKey}>
          使用自備金鑰
        </Button>
      </div>
    </Callout>
  );
}

/** 「查看方案」：打開帳號頁（跟 Page 上的紅色標籤一樣）。沒給 onViewPlans（網站上的展示）時停用。 */
function ViewPlansButton({ variant, onViewPlans }: { variant: 'primary' | 'link'; onViewPlans: (() => void) | undefined }) {
  return (
    <Button variant={variant} disabled={!onViewPlans} onClick={onViewPlans}>
      查看方案
    </Button>
  );
}

/**
 * 額度用完（#92、#94 畫面定案）：逐字稿上方的 warn Callout。已翻過的頁照常顯示快取的譯文，新的頁只有原文與讀音。
 * 免費額度用完有年繳、季繳兩行價格與「查看方案」；本月額度用完只有「使用自備金鑰」（等重置）。
 */
function QuotaExhaustedCallout({
  exhausted,
  onViewPlans,
  onUseOwnKey,
}: {
  exhausted: NonNullable<QuotaView['exhausted']>;
  onViewPlans: (() => void) | undefined;
  onUseOwnKey: () => void;
}) {
  return (
    <Callout tone="warn" class="naru-callout--stack" role="group" aria-label="額度已用完">
      <p>
        <strong>{exhausted.title}</strong>
      </p>
      <p>{exhausted.body}</p>
      {exhausted.offers && <SubscriptionPrice offers={exhausted.offers} />}
      <div class="naru-row">
        {exhausted.offers && <ViewPlansButton variant="primary" onViewPlans={onViewPlans} />}
        <Button variant="link" onClick={onUseOwnKey}>
          使用自備金鑰
        </Button>
      </div>
    </Callout>
  );
}

/** 剩餘頁數那一行：平常在逐字稿最下面，快用完、用完時在固定列並用警告色（按鈕放置方案）。 */
function QuotaLine({ line, onViewPlans }: { line: QuotaLineView; onViewPlans: (() => void) | undefined }) {
  return (
    <div role="status" aria-label="剩餘額度" class={`status-row quota-row${line.warn ? ' quota-row--warn' : ''}`}>
      <span>{line.text}</span>
      {line.plansLink && <ViewPlansButton variant="link" onViewPlans={onViewPlans} />}
    </div>
  );
}

/**
 * 底部固定列（#77、#92；按鈕放置方案）：有事才出現，最多一顆按鈕——進度、「N 頁還沒翻譯」＋「翻譯此頁」、快用完或用完的額度。
 * 放在 main 外面才是 contentinfo landmark。
 */
function PanelFooter({ footer, onTranslate, onViewPlans }: { footer: FooterView; onTranslate: () => void; onViewPlans: (() => void) | undefined }) {
  const { quota, plans, row } = footer;
  return (
    <footer aria-label="狀態列">
      {quota && (
        // 免費額度用完：primary「查看方案」跟那行同一行，但放在 status 外面，狀態只念剩餘頁數
        <div class="status-row">
          <QuotaLine line={quota} onViewPlans={onViewPlans} />
          {plans && <ViewPlansButton variant="primary" onViewPlans={onViewPlans} />}
        </div>
      )}
      {row && (
        <div class="status-row">
          {row.kind === 'translate' ? (
            <>
              <span>{pageCount(row.untranslated)} 頁還沒翻譯</span>
              {/* 只翻辨識好、還沒翻的頁，不重新擷取（規則在 translateAction） */}
              <Button variant="primary" onClick={onTranslate}>
                翻譯此頁
              </Button>
            </>
          ) : (
            <Progress>{row.kind === 'translating' ? '翻譯中…' : '辨識中…'}</Progress>
          )}
        </div>
      )}
    </footer>
  );
}

/**
 * 逐字稿最下面的「這個畫面」（按鈕放置方案）：秒數（自備金鑰加模型、費用）、平常的剩餘頁數、條漫計頁、回報翻譯問題、重新翻譯。
 * 「重新翻譯」會從辨識整個重來、扣頁，平常很少用，所以不放固定列；扣多少寫在按鈕下面的小字，不另外確認。
 */
function ScreenEnd({
  end,
  report,
  onRetranslate,
  onViewPlans,
}: {
  end: EndView;
  report: ComponentChildren;
  onRetranslate: () => void;
  onViewPlans: (() => void) | undefined;
}) {
  const { retranslate } = end;
  return (
    <section class="screen-end" aria-label="這個畫面">
      <h2 class="screen-end__title">這個畫面</h2>
      {end.summary && (
        <p role="status" aria-label="翻譯摘要">
          {end.summary}
        </p>
      )}
      {end.quota && <QuotaLine line={end.quota} onViewPlans={onViewPlans} />}
      {end.strip && (
        <div role="status" aria-label="條漫計費" class="status-row quota-row">
          <span>{end.strip}</span>
        </div>
      )}
      {end.report && report}
      {retranslate && (
        <div class="screen-end__retranslate">
          <RetranslateButton variant="ghost" note={retranslate.note} disabled={retranslate.disabled} onClick={onRetranslate} />
        </div>
      )}
    </section>
  );
}

const PAGE_MODES: readonly SegmentOption<PageMode>[] = [
  { value: 'read', label: '閱讀', description: '漫畫頁面直接顯示中文' },
  { value: 'learn', label: '學習', description: '漫畫頁面保留日文，滑過看讀音；逐字稿的譯文也先收起來' },
];

/** 漫畫頁面的小圖示：跟逐字稿標題列的側邊欄圖示成對（U15）。 */
function PageIcon() {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <rect x="0.75" y="0.75" width="10.5" height="12.5" rx="1.5" />
    </svg>
  );
}

/**
 * Page Mode 切換（spec #70、#73）：全域設定，外掛存在 chrome.storage.local；頁面上的 content script 自己聽變更。
 * 學習時頁面不擦字、不畫譯文，翻譯照常進行。一行寫著「漫畫頁面」，跟逐字稿標題列的顯示選單分開，各自標出管哪裡（U15）；
 * 兩種模式的說明在按鈕的 hover 提示裡。
 */
function PageModeSwitch({ mode, choose }: { mode: PageMode; choose: (mode: PageMode) => void }) {
  return (
    <div class="page-mode">
      <PageIcon />
      <span class="page-mode__label" aria-hidden="true">
        漫畫頁面
      </span>
      <SegmentedControl label="頁面模式" options={PAGE_MODES} value={mode} onChange={choose} />
    </div>
  );
}

/** 標題：logo（外掛 icon 的小尺寸母檔）＋名稱。 */
function Title({ logoSrc }: { logoSrc: string }) {
  return (
    <h1 class="title">
      <img src={logoSrc} alt="" width={24} height={24} />
      Naruhodo
    </h1>
  );
}

/** 齒輪圖示（⚙：打開設定頁）。 */
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/** ⚙：直接打開設定頁（不常用的功能都在設定頁裡）。 */
function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button variant="icon" aria-label="設定" onClick={onOpen}>
      <GearIcon />
    </Button>
  );
}

export interface SidePanelProps {
  /** 有已啟動的 tab：顯示 Page Mode 與逐字稿；false＝只顯示「請點外掛圖示啟動」。 */
  running: boolean;
  /** 沒啟動的原因是這個 tab 的作品剛被刪掉（#214）：顯示「這部作品已刪除」取代「請點外掛圖示啟動」。 */
  seriesDeleted?: boolean;
  pages: PageView[];
  modelStatus: ModelStatus;
  /** 翻譯模式與能不能翻（內建翻譯有沒有登入、自備金鑰有沒有 key）；不能翻時顯示提示。 */
  access: TranslationAccess;
  /** 目前翻譯模式的資料使用同意；沒同意就顯示說明卡（內建翻譯沒登入時除外，同意在登入時取得），undefined＝還在讀（不顯示）。 */
  consent: ConsentState | undefined;
  pageMode: PageMode;
  /** 頁面上滑鼠所在的那句（逐字稿那行高亮）。 */
  hovered: LineRef | undefined;
  /** 標題旁的 logo（外掛是 icons/naruhodo-small.svg）。 */
  logoSrc: string;
  onPageModeChange: (mode: PageMode) => void;
  /** 逐字稿的顯示方式（Display Level 與振り仮名開關）；依 Page Mode 用其中一個。 */
  transcriptDisplay: TranscriptDisplay;
  onTranscriptDisplayChange: (display: TranscriptDisplay) => void;
  /** 重新擷取頁面（模型錯誤的「重試」）。 */
  onScan: () => void;
  /** 翻譯這個 tab 的頁；給 pageHash 就只重翻那一頁。 */
  onTranslate: (pageHash?: string) => void;
  /** 底部的「重新翻譯」：畫面上的頁從辨識開始整個重來（Retranslation）。 */
  onRetranslate: () => void;
  /** 滑過逐字稿的某行；null＝離開。 */
  onLineHover: (line: LineRef | null) => void;
  /** 說明卡的「同意並啟用翻譯」：記下目前翻譯模式的同意。 */
  onAcceptConsent: () => void;
  /** 「尚未登入」與額度用完的「使用自備金鑰」：切到自備金鑰（設定頁同時打開）。 */
  onUseOwnKey: () => void;
  /** 「登入」「改用內建翻譯」：外掛打開 onboarding 的第 2 步（同意並登入）。 */
  onSignIn: () => void;
  /** onboarding 做完了沒（#93）；false＝只顯示「完成設定」。沒給＝完成（網站上）。 */
  setupComplete?: boolean;
  /** 「完成設定」：打開 onboarding，回到停下來的那一步。 */
  onFinishSetup?: () => void;
  /** 從舊版更新、仍用自備金鑰：顯示一次「現在也可以改用內建翻譯」。 */
  hostedHint?: boolean;
  /** 內建翻譯提示的任何一個按鈕：記下已經關掉。 */
  onDismissHostedHint?: () => void;
  /** 內建翻譯的剩餘額度（Worker 的 GET /v1/account）；undefined＝還在讀、沒登入或自備金鑰。 */
  quota?: Quota;
  /** 這個分頁正在讀 Strip（條漫，#282）時，它到目前計了幾句、幾頁；不是 Strip 時 undefined。 */
  strip?: StripStatus;
  /** 「查看方案」：打開帳號與訂閱頁（spec #254）；沒給時（網站上的展示）按鈕停用。 */
  onViewPlans?: () => void;
  /** 帳號頁發起的付款確認了（#176）：顯示一次「已訂閱」，帶付款的扣款週期。 */
  subscribedNotice?: BillingPeriod;
  onDismissSubscribedNotice?: () => void;
  /**
   * 「回報翻譯問題」（Problem Report，GLOSSARY）：copy 把報告寫進剪貼簿，open 打開 Discussions 的回報表單。
   * 沒給就不顯示按鈕（網站上的展示）。
   */
  reportProblem?: { copy: () => Promise<void>; open: () => void };
  /** 以下是只有外掛 container 才有的區塊（會讀寫 store、送 chrome 訊息）；沒給就不顯示（沒有設定頁就沒有 ⚙）。 */
  /** Transcript 上方的作品卡（#186）；open 打開作品頁或換一部作品（#191）。 */
  renderSeriesCard?: (open: (page: SeriesPage) => void) => ComponentChildren;
  /** 「設定」頁的內容（標題列由 SidePanel 畫）。 */
  renderSettings?: (close: () => void) => ComponentChildren;
  /**
   * 作品頁（作品身分＋Series Notes）與換一部作品的內容（#191，標題列由 SidePanel 畫）；
   * navigate 換到另一頁，undefined＝回到逐字稿。
   */
  renderSeries?: (page: SeriesPage, navigate: (page: SeriesPage | undefined) => void) => ComponentChildren;
}

/** 從作品卡打得開的頁（#191）。 */
export type SeriesPage = Extract<PanelPage, 'series' | 'seriesPick'>;

/** 沒做完 onboarding（#93 畫面定案）：只有置中的大 logo、名稱、「設定還沒完成」與「完成設定」，沒有頂部的狀態與 ⚙。 */
function FinishSetup({ logoSrc, onFinishSetup }: { logoSrc: string; onFinishSetup: (() => void) | undefined }) {
  return (
    <div class="naru-side-panel">
      <main class="finish-setup">
        <img src={logoSrc} alt="" width={48} height={48} />
        <h1>Naruhodo</h1>
        <p>設定還沒完成</p>
        <Button variant="primary" onClick={onFinishSetup}>
          完成設定
        </Button>
      </main>
    </div>
  );
}

const PAGE_TITLES: Record<PanelPage, string> = { settings: '設定', series: '作品', seriesPick: '換一部作品' };

/** 整個取代 side panel 的一頁（設定、作品頁…）：頂部是「←」＋標題，沒有逐字稿與底部狀態列。 */
function PanelPageView({ title, onBack, children }: { title: string; onBack: () => void; children: ComponentChildren }) {
  return (
    <div class="naru-side-panel">
      <main>
        <div class="panel-header">
          <Button variant="icon" aria-label="返回" onClick={onBack}>
            ←
          </Button>
          <h1 class="title">{title}</h1>
        </div>
        {children}
      </main>
    </div>
  );
}

/**
 * 逐字稿最下面的「回報翻譯問題」：先複製再開分頁（開了分頁 side panel 就失去焦點，剪貼簿寫不進去）。
 * 複製好之後留著說明與「再複製一次」：讀者到 GitHub 之前可能又複製了別的東西。
 */
function ReportProblem({ copy, open }: NonNullable<SidePanelProps['reportProblem']>) {
  const [copied, setCopied] = useState<'copied' | 'failed' | undefined>(undefined);
  const copyReport = async () => {
    try {
      await copy();
      setCopied('copied');
      return true;
    } catch (e) {
      console.warn('copy problem report failed', e);
      setCopied('failed');
      return false;
    }
  };
  const copyThenOpen = () => void copyReport().then((ok) => ok && open());
  return (
    <section class="report-problem" aria-label="回報翻譯問題">
      {copied === undefined && (
        <Button variant="ghost" onClick={copyThenOpen}>
          回報翻譯問題
        </Button>
      )}
      {copied === 'copied' && (
        <Callout role="status" class="naru-callout--stack">
          <p>報告已複製。請貼到 GitHub 表單最下面的「報告」欄位，再用自己的話寫哪一頁、哪裡有問題。</p>
          <div class="naru-row">
            <Button variant="ghost" onClick={() => void copyReport()}>
              再複製一次
            </Button>
            <Button variant="ghost" onClick={open}>
              打開回報表單
            </Button>
          </div>
        </Callout>
      )}
      {copied === 'failed' && (
        <Callout role="alert" class="naru-callout--stack">
          <p>沒辦法複製報告，請再按一次。</p>
          <div class="naru-row">
            <Button variant="ghost" onClick={copyThenOpen}>
              再試一次
            </Button>
          </div>
        </Callout>
      )}
    </section>
  );
}

export function SidePanel(props: SidePanelProps) {
  const { running, pages, modelStatus, access, consent, pageMode, hovered, onScan, onTranslate } = props;
  const saved = props.transcriptDisplay;
  const display = currentDisplay(pageMode, saved);
  const [page, setPage] = useState<PanelPage | undefined>(undefined);
  // 逐字稿譯文的標點字型（side-panel.css 的 .translation）；外掛、產品網站的展示都 render 這個元件，所以在這裡載入
  useEffect(() => void loadPunctuationFont(), []);

  // 作品頁跟著已啟動的 tab：停用了（停止、作品被刪掉，#214）就回到主畫面，之後再啟動也不會停在舊的作品頁
  const onSeriesPage = page === 'series' || page === 'seriesPick';
  useEffect(() => {
    if (!running && onSeriesPage) setPage(undefined);
  }, [running, onSeriesPage]);

  const close = () => setPage(undefined);
  const screen = sidePanelScreen({ setupComplete: props.setupComplete ?? true, page: !running && onSeriesPage ? undefined : page });
  if (screen === 'finishSetup') return <FinishSetup logoSrc={props.logoSrc} onFinishSetup={props.onFinishSetup} />;
  if (screen !== 'transcript') {
    const back = () => setPage(parentPage(screen));
    const content = {
      settings: () => props.renderSettings?.(close),
      series: () => props.renderSeries?.('series', setPage),
      seriesPick: () => props.renderSeries?.('seriesPick', setPage),
    }[screen];
    return (
      <PanelPageView title={PAGE_TITLES[screen]} onBack={back}>
        {content()}
      </PanelPageView>
    );
  }
  // 頂部只有 logo、名稱、狀態、⚙（#77）；停止＝再點一次外掛圖示，⚙ 直接打開設定頁
  const header = (
    <div class="panel-header">
      <Title logoSrc={props.logoSrc} />
      {running && <Badge tone="ok">已啟動</Badge>}
      <span class="panel-header__spacer" />
      {props.renderSettings && <SettingsButton onOpen={() => setPage('settings')} />}
    </div>
  );
  const done = pages.filter((p) => p.transcript.state === 'done');
  const untranslated = hasUntranslated(pages);
  const notices = setupNotices({ access, consent, untranslated, hostedHint: props.hostedHint });
  const consentCard = notices.consentCard && <DataConsentCard mode={access.mode} card={notices.consentCard} onAccept={props.onAcceptConsent} />;
  const useOwnKey = () => {
    props.onUseOwnKey();
    setPage('settings');
  };
  // 付款確認後讀者被帶回來時，side panel 不一定已經啟動，兩種畫面都顯示
  const subscribedNotice = props.subscribedNotice && (
    <Callout tone="info" class="naru-callout--stack" role="group" aria-label="已訂閱">
      <p>{subscribedNoticeText(props.subscribedNotice)}</p>
      <div class="naru-row">
        <Button variant="ghost" onClick={() => props.onDismissSubscribedNotice?.()}>
          知道了
        </Button>
      </div>
    </Callout>
  );
  if (!running)
    return (
      <div class="naru-side-panel">
        <main>
          {header}
          {consentCard}
          {subscribedNotice}
          {props.seriesDeleted ? (
            <Callout role="status">這部作品已刪除。重新啟動外掛會當成新的作品開始翻譯。</Callout>
          ) : (
            <p>請點外掛圖示啟動</p>
          )}
        </main>
      </div>
    );
  const translate = () => onTranslate();
  const view = sidePanelView(pages, access.mode);
  const quota = quotaView(access, props.quota);
  const strip = stripView(access, props.strip);
  // 沒登入、沒 key、還沒同意時按了也送不出去：不放「翻譯此頁」，由上面的設定提示帶路
  const layout = panelLayout({ pages, access, translatable: canTranslate(access, consent === 'agreed'), quota: props.quota, strip });
  const staleCharge = chargeNote(access, props.quota, strip !== undefined, 1);
  const sync: TranscriptSync = { display, hovered, onLineHover: props.onLineHover };
  return (
    <div class="naru-side-panel">
      <main>
        {header}
        {consentCard}
        <PageModeSwitch mode={pageMode} choose={props.onPageModeChange} />
        <ModelStatusLine status={modelStatus} onRetry={onScan} />
        <SetupNoticeCallout
          notice={notices.notice}
          onSignIn={props.onSignIn}
          onUseOwnKey={useOwnKey}
          onDismissHostedHint={() => props.onDismissHostedHint?.()}
        />
        {quota.exhausted && <QuotaExhaustedCallout exhausted={quota.exhausted} onViewPlans={props.onViewPlans} onUseOwnKey={useOwnKey} />}
        {subscribedNotice}
        {props.renderSeriesCard?.(setPage)}
        {done.length > 0 && (
          <TranscriptHeading
            display={display}
            onLevel={(level) => props.onTranscriptDisplayChange({ ...saved, level })}
            onFurigana={(furigana) => props.onTranscriptDisplayChange({ ...saved, furigana })}
          />
        )}
        {/* 不是錯誤：首頁、目錄頁本來就沒有 Page（縮圖太小不算），讓讀者知道外掛是刻意沒翻 */}
        {pages.length === 0 && <Callout role="status">這個畫面沒有找到漫畫頁</Callout>}
        {strip && <Callout role="status">{strip.notice}</Callout>}
        <ul aria-label="Page">
          {view.pages.map((entry) => (
            // 同一個 anchor 可能有兩個 Page（Spread），key 要帶 Page 身分
            <PageItem
              key={`${entry.page.anchorId}/${entry.page.pageHash}`}
              entry={entry}
              onRetry={translate}
              onRetranslate={() => onTranslate(entry.page.pageHash)}
              staleCharge={staleCharge}
              sync={sync}
            />
          ))}
        </ul>
        {layout.end && (
          <ScreenEnd
            end={layout.end}
            report={
              // 翻頁、換了畫面上的 Page：「報告已複製」是上一個畫面的，回到按鈕
              props.reportProblem && <ReportProblem key={done.map((p) => p.pageHash).join()} {...props.reportProblem} />
            }
            onRetranslate={props.onRetranslate}
            onViewPlans={props.onViewPlans}
          />
        )}
      </main>
      {layout.footer && <PanelFooter footer={layout.footer} onTranslate={translate} onViewPlans={props.onViewPlans} />}
    </div>
  );
}
