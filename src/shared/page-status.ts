/**
 * 全站狀態與圖示 badge（#185）：不開側邊欄的讀者也看得到翻譯中、模型下載中、出問題。
 * SW 依每個 tab 的 PageView 算出來，content script 畫成視窗右上角唯一的一個面板（top layer，網站的控制列蓋不到）、
 * SW 設成圖示的 badge。面板照閱讀順序每頁一列（位置圖示＋「右頁 · 先讀」＋狀態），都翻好了就收起來。
 */
import type { ModelStatus, PageView, QuotaExhausted } from './messages.ts';
import type { RequestedStep } from './onboarding-step.ts';
import { readingOrder, type OrderedPage, type SpreadSide } from './spread-order.ts';

/** 紅色那一列的按鈕做什麼：plan＝打開帳號頁（#213）；signIn＝登入、consent＝補同意、ownKey＝設定 API key 打開 onboarding 的那一步；retry＝重試這一頁。 */
export type StatusAction = RequestedStep | 'retry';

/** 一列前面的位置圖示：Spread 亮左或右那格、只有一頁是一格、很多頁用編號、條漫是一條長的。 */
export type PageIcon = { kind: 'spread'; side: SpreadSide } | { kind: 'single' } | { kind: 'number'; n: number } | { kind: 'strip' };

export type RowState =
  /** 在等前面的頁跑完本機流水線（或等模型）。 */
  | { kind: 'queued' }
  | { kind: 'working'; text: string }
  | { kind: 'done' }
  /** 本機流水線或翻譯失敗：這一列有「重試」。 */
  | { kind: 'failed' };

export interface StatusRow {
  pageHash: string;
  icon: PageIcon;
  title: string;
  state: RowState;
}

/** 所有卡住的頁都是同一個原因（額度用完、沒登入）：合成一列，不每頁重複。 */
export interface SharedProblem {
  title: string;
  detail: string;
  action: Exclude<StatusAction, 'retry'>;
  /** 按鈕的字。 */
  label: string;
  /** 卡住的其中一頁（SW 收到點擊時用）。 */
  pageHash: string;
}

/** 視窗右上角的面板；有頁在忙或出問題才有。 */
export interface StatusPanel {
  /** working：有頁在忙，text 是收合時那一行（模型下載有 progress 0–1）；problem：沒在忙、有要讀者處理的。 */
  header: { kind: 'working'; text: string; progress?: number } | { kind: 'problem'; text: string };
  /** 收合時那一行後面的位置圖示：正在處理（或排在最前面）的那頁；沒有就不放。 */
  current?: PageIcon;
  rows: StatusRow[];
  /** 列不下（MAX_ROWS）的頁數。 */
  more: number;
  problems: SharedProblem[];
  /** 有要讀者處理的：一直展開，不等滑過。 */
  expanded: boolean;
}

/**
 * 圖示 badge：翻譯中 …、有問題 !、已啟動沒事是一個綠點，額度快用完（#237）是橘點。
 * 正在讀照句數計頁的 Strip（條漫，#282）時，圓點換成「條」字（strip），快用完一樣換成橘色底（stripLowQuota）。
 */
export type ActionBadge = 'busy' | 'problem' | 'lowQuota' | 'on' | 'strip' | 'stripLowQuota';

export interface PageStatusInput {
  /** 這個 tab 畫面上的 Page。 */
  pages: PageView[];
  model: ModelStatus;
  /** 正在跑本機流水線的 Page（pageHash）；其他 analyzing、也還沒送 LLM 的在排隊。 */
  inLocalPipeline: ReadonlySet<string>;
  /** 已經送出 LLM 的 Page（pageHash）。 */
  translating: ReadonlySet<string>;
  /** 現在不能翻譯的原因（沒登入 → signIn，還登入著但沒同意 → consent，自備金鑰沒有 key 或沒同意 → ownKey）；能翻是 undefined。 */
  access: Exclude<RequestedStep, 'plan'> | undefined;
  /** 內建翻譯的額度快用完（shared/quota-indicator.ts）；額度是全域的，每個 tab 都一樣。 */
  lowQuota: boolean;
  /** 這個 tab 正在讀 Strip、而且用內建翻譯（照句數計頁，#282）。 */
  strip?: boolean;
}

/** 面板最多列幾頁；再多的合成「還有 N 頁」。 */
export const MAX_ROWS = 5;

/**
 * 沒翻譯、也沒有錯或額度用完：只有不能翻（沒登入、沒有 key）才算問題，能翻的話是沒有字的頁。
 * SW 只在有這種頁時才去問能不能翻（page-status-sync.ts）。
 */
export const untranslatedWithoutReason = ({ transcript }: PageView): boolean =>
  transcript.state === 'done' && !transcript.translated && !transcript.translating && !transcript.translateError && !transcript.quotaExhausted;

function rowState(page: PageView, { model, inLocalPipeline, translating }: PageStatusInput): RowState {
  const { transcript } = page;
  if (transcript.state === 'error') return { kind: 'failed' };
  if (transcript.state === 'done') {
    // 在側邊欄按了「重新翻譯」（或「翻譯此頁」）：舊的原文還在
    if (transcript.translating) return { kind: 'working', text: transcript.translated ? '重新翻譯中…' : '翻譯中…' };
    return transcript.translateError ? { kind: 'failed' } : { kind: 'done' };
  }
  if (translating.has(page.pageHash)) return { kind: 'working', text: '翻譯中…' };
  // 模型還沒好：辨識不了，進度寫在標題
  if (!inLocalPipeline.has(page.pageHash) || model.state === 'downloading' || model.state === 'loading') return { kind: 'queued' };
  return { kind: 'working', text: '辨識文字…' };
}

/** 這一頁在畫面上的哪裡：Spread 跟 side panel 的頁首同一種說法。 */
function position({ page, side }: OrderedPage, n: number, total: number): Pick<StatusRow, 'icon' | 'title'> {
  if (side === 'right') return { icon: { kind: 'spread', side }, title: '右頁 · 先讀' };
  if (side === 'left') return { icon: { kind: 'spread', side }, title: '左頁 · 後讀' };
  // 長 Page 一截一截處理，只說得出畫面上這段
  if (page.stripes) return { icon: { kind: 'strip' }, title: '畫面上這一段' };
  if (total === 1) return { icon: { kind: 'single' }, title: '這一頁' };
  return { icon: { kind: 'number', n }, title: `第 ${n} 頁` };
}

const isBusy = ({ state }: StatusRow) => state.kind === 'queued' || state.kind === 'working';

/** 列不下時：先拿掉前面翻好的（讀者已經看過），還不夠再從後面截。 */
function fit(rows: StatusRow[]): { rows: StatusRow[]; more: number } {
  let start = 0;
  while (rows.length - start > MAX_ROWS && rows[start]!.state.kind === 'done') start++;
  const shown = rows.slice(start, start + MAX_ROWS);
  return { rows: shown, more: rows.length - start - shown.length };
}

function header(rows: StatusRow[], { model }: PageStatusInput): StatusPanel['header'] {
  if (model.state === 'downloading') {
    const progress = model.total > 0 ? model.loaded / model.total : 0;
    return { kind: 'working', text: `下載文字辨識模型 ${Math.round(progress * 100)}%`, progress };
  }
  if (model.state === 'loading') return { kind: 'working', text: '載入文字辨識模型…' };
  const busy = rows.filter(isBusy);
  // 條漫的一截不是一頁
  if (busy.every(({ icon }) => icon.kind === 'strip')) return { kind: 'working', text: '處理中' };
  return { kind: 'working', text: `${busy.length} 頁處理中` };
}

type Blocked = QuotaExhausted | Exclude<RequestedStep, 'plan'>;

/** 卡住、不是這一頁自己的問題（額度、帳號）：同一個原因的頁合成一列。 */
function blocked({ transcript }: PageView, access: PageStatusInput['access']): Blocked | undefined {
  if (transcript.state !== 'done' || transcript.translated || transcript.translating || transcript.translateError) return undefined;
  // 沒翻譯、也沒有錯：能翻的話是沒有字的頁（長 Page 還沒收到字），不算問題
  return transcript.quotaExhausted ?? access;
}

/** 合併那一列的標題、按鈕；detail 沒寫的是「這 N 頁沒有翻」。 */
const BLOCKED: Record<Blocked, Omit<SharedProblem, 'pageHash' | 'detail'> & { detail?: string }> = {
  free: { title: '免費額度用完了', action: 'plan', label: '查看方案' },
  monthly: { title: '本月額度用完了', action: 'plan', label: '查看方案' },
  // 不是讀者自己的額度用完，不能說成「免費額度用完了」（#241）
  pausedToday: { title: '今天的免費額度已經發完', detail: '明天再試', action: 'plan', label: '查看方案' },
  signIn: { title: '還沒登入', action: 'signIn', label: '登入' },
  consent: { title: '資料使用說明更新了', detail: '同意後才能繼續翻', action: 'consent', label: '查看' },
  ownKey: { title: '還沒設定 API key', action: 'ownKey', label: '設定' },
};

export function pageStatus(input: PageStatusInput): { panel: StatusPanel | undefined; badge: ActionBadge } {
  const ordered = readingOrder(input.pages);
  const rows: StatusRow[] = [];
  const stuck = new Map<Blocked, string[]>();
  ordered.forEach((entry, i) => {
    const reason = blocked(entry.page, input.access);
    if (reason) stuck.set(reason, [...(stuck.get(reason) ?? []), entry.page.pageHash]);
    else rows.push({ pageHash: entry.page.pageHash, ...position(entry, i + 1, ordered.length), state: rowState(entry.page, input) });
  });
  const problems = [...stuck].map(([reason, pageHashes]): SharedProblem => {
    const { detail, ...problem } = BLOCKED[reason];
    return { ...problem, detail: detail ?? `這 ${pageHashes.length} 頁沒有翻`, pageHash: pageHashes[0]! };
  });
  const busy = rows.some(isBusy);
  const problem = problems.length > 0 || rows.some(({ state }) => state.kind === 'failed');
  const current = (rows.find(({ state }) => state.kind === 'working') ?? rows.find(({ state }) => state.kind === 'queued'))?.icon;
  const panel: StatusPanel | undefined =
    busy || problem
      ? {
          header: busy ? header(rows, input) : { kind: 'problem', text: '需要你處理' },
          ...(current && { current }),
          ...fit(rows),
          problems,
          expanded: problem,
        }
      : undefined;
  return {
    panel,
    // 出問題 > 翻譯中 > 快用完 > 平常：翻譯中先顯示藍色，翻完再變回橘色
    badge: problem ? 'problem' : busy ? 'busy' : input.strip ? (input.lowQuota ? 'stripLowQuota' : 'strip') : input.lowQuota ? 'lowQuota' : 'on',
  };
}
