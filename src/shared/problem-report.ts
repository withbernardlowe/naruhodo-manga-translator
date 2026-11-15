import type { ModelStatus, PageView, Size } from './messages.ts';
import type { PageMode } from './page-mode.ts';
import type { BalloonText, LooseText, RatioRect } from './page-text.ts';
import type { UsedNote } from './translator.ts';
import type { TranslationMode } from './translation-mode.ts';

/**
 * Problem Report（問題回報，GLOSSARY）：side panel 的「回報翻譯問題」把畫面上的 Page 寫成一份文字報告，讀者自己貼到
 * Discussions。上半部給人看（每句一行），下半部 <details> 裡的 JSON 給之後修問題的 agent 讀。
 *
 * 報告裡沒有任何圖片（PRIVACY.md「Reporting a problem」）：縮圖、擦除小圖都是截圖切出來的，一律不放。所以每句的欄位
 * 是一個一個挑出來的，不展開整個物件；之後 PageText 多了欄位也不會自己跑進報告。
 */
export interface ProblemReportInput {
  extensionVersion: string;
  userAgent: string;
  translationMode: TranslationMode;
  pageMode: PageMode;
  modelStatus: ModelStatus;
  /** side panel 手上的畫面上的 Page（依閱讀順序）。 */
  pages: PageView[];
  /** SW 補上 side panel 拿不到的（ProblemReportContext）。 */
  context: ProblemReportContext;
}

/** panel:problemReport 的回應：SW 與 content script 才知道的。 */
export interface ProblemReportContext {
  /** 頁面網址只留 origin＋path（跟網址模式一樣，`?`、`#` 之後可能有登入 token）。 */
  pageUrl?: string;
  /** 瀏覽器縮放比例（1＝100%）。 */
  zoom?: number;
  viewport?: Size;
  devicePixelRatio?: number;
  seriesName?: string;
  /** 翻譯快取裡這幾頁的紀錄；沒有快取的頁不列。 */
  pages: CachedPageInfo[];
}

export interface CachedPageInfo {
  pageHash: string;
  promptVersion: string;
  translatedAt: number;
  usedNotes: UsedNote[];
}

type ReportLine = { kind: 'balloon'; text: BalloonText } | { kind: 'loose'; text: LooseText };

const KIND_LABEL = { balloon: '對話框', loose: '框外文字' } as const;

/** 一頁的句子照閱讀順序（Balloon 與 Loose Text 共用一串 order）。 */
function linesOf(page: PageView): ReportLine[] {
  if (page.transcript.state !== 'done') return [];
  const { balloons, looseText } = page.transcript.text;
  return [
    ...balloons.map((text): ReportLine => ({ kind: 'balloon', text })),
    ...looseText.map((text): ReportLine => ({ kind: 'loose', text })),
  ].sort((a, b) => a.text.order - b.text.order);
}

/** 報告裡 Page 與句子的編號：P1 是畫面上第 1 頁，P1-L3 是它閱讀順序第 3 句；表單的「哪一句」填這個。 */
const pageId = (pageIndex: number) => `P${pageIndex + 1}`;
const lineId = (pageIndex: number, order: number) => `${pageId(pageIndex)}-L${order}`;

function humanLine(pageIndex: number, line: ReportLine): string {
  const { order, 原文, 譯文, unreadable } = line.text;
  const result = unreadable ? '（無法辨識）' : 譯文 === '' ? '（未翻譯）' : ` → ${譯文}`;
  return `- ${lineId(pageIndex, order)} ${KIND_LABEL[line.kind]}：${原文}${result}`;
}

/** 比例座標留三位小數就夠看出框歪在哪，報告短一點（Discussion 內文上限約 65 KB）。 */
const round = (n: number) => Math.round(n * 1000) / 1000;
const ratioBox = (r: RatioRect) => [round(r.x), round(r.y), round(r.w), round(r.h)];

function lineJson(pageIndex: number, line: ReportLine) {
  const t = line.text;
  const boxes = line.kind === 'balloon' ? { balloonBbox: ratioBox(line.text.balloonBbox), textBbox: ratioBox(line.text.textBbox) } : { bbox: ratioBox(line.text.bbox) };
  return {
    id: lineId(pageIndex, t.order),
    kind: line.kind,
    orientation: t.orientation,
    ...boxes,
    原文: t.原文,
    讀音: t.讀音,
    譯文: t.譯文,
    unreadable: t.unreadable,
    ocrConfidence: t.ocrConfidence === undefined ? undefined : round(t.ocrConfidence),
    ocrDropped: t.ocrDropped,
    sfx: t.sfx,
    eraseLuminance: t.eraseLuminance,
  };
}

function pageJson(page: PageView, pageIndex: number, cached: CachedPageInfo | undefined) {
  const { transcript } = page;
  const done = transcript.state === 'done' ? transcript : undefined;
  return {
    id: pageId(pageIndex),
    pageHash: page.pageHash,
    rect: page.rect,
    subRect: page.subRect && ratioBox(page.subRect),
    long: page.stripes ? true : undefined,
    state: transcript.state,
    error: transcript.state === 'error' ? transcript.message : undefined,
    translation: done?.translation && { source: done.translation.source, model: done.translation.model, latencyMs: done.translation.latencyMs },
    translateError: done?.translateError,
    stale: done?.stale,
    promptVersion: cached?.promptVersion,
    translatedAt: cached && new Date(cached.translatedAt).toISOString(),
    usedNotes: cached?.usedNotes,
  };
}

/**
 * 把 `obj` 寫成一行 JSON，最後加上陣列 `key`，陣列每個元素各一行（元素已是 JSON 字串）。
 * 報告的 JSON 一句一行：不縮排會擠成一長行，整份縮排又會把 bbox 拆成一個數字一行、長度翻倍。
 */
function withRows(obj: object, key: string, rows: string[]): string {
  const head = JSON.stringify(obj);
  const open = head === '{}' ? '{' : `${head.slice(0, -1)},`;
  return `${open}${JSON.stringify(key)}:[${rows.length ? `\n${rows.join(',\n')}\n` : ''}]}`;
}

function pageRows(page: PageView, pageIndex: number, cached: CachedPageInfo | undefined): string {
  const info = pageJson(page, pageIndex, cached);
  if (page.transcript.state !== 'done') return JSON.stringify(info);
  return withRows(info, 'lines', linesOf(page).map((line) => JSON.stringify(lineJson(pageIndex, line))));
}

export function problemReport(input: ProblemReportInput): string {
  const { context } = input;
  const human = input.pages.map((page, i) => [`**${pageId(i)}**`,...linesOf(page).map((line) => humanLine(i, line))].join('\n')).join('\n\n');
  const data = {
    extensionVersion: input.extensionVersion,
    userAgent: input.userAgent,
    translationMode: input.translationMode,
    pageMode: input.pageMode,
    ocr: input.modelStatus,
    pageUrl: context.pageUrl,
    zoom: context.zoom,
    viewport: context.viewport,
    devicePixelRatio: context.devicePixelRatio,
    series: context.seriesName,
  };
  const pages = input.pages.map((page, i) => pageRows(page, i, context.pages.find((c) => c.pageHash === page.pageHash)));
  return [
    '### 畫面上的句子',
    human,
    '<details>\n<summary>給開發者的資料（JSON）</summary>',
    '```json\n' + withRows(data, 'pages', pages) + '\n```',
    '</details>',
  ].join('\n\n');
}
