/**
 * 首頁互動展示（#109）的進度：點圖示 → 辨識中 → 翻譯中 → 完成，全部用計時器模擬，不跑 OCR、不連網路。
 * 這裡只算「現在 side panel 與頁面該顯示什麼」，畫面是外掛的 SidePanel 與 createOverlay（Demo.tsx）。
 * 圖示跟外掛一樣是開關（ADR 0003、src/background/activation.ts 的 toggle）：沒啟動就啟動並打開 side panel，
 * 已啟動就停止並關掉 side panel；side panel 的「停止」也一樣（activation.ts 的 stopAndDisablePanel）。
 */
import { CLAUDE_MODEL } from '../../../src/shared/claude-request.ts';
import type { PageView } from '../../../src/shared/messages.ts';
import type { PageText } from '../../../src/shared/page-text.ts';
import { FREE_PAGES } from '../../../src/shared/hosted-api.ts';

/** 展示從新帳號的 Free Pages 開始；翻完一個 Page 少一頁（跨頁是兩頁）。 */
export { FREE_PAGES };

/** closed＝沒啟動（或停止了）、side panel 關著。 */
export type DemoPhase = 'closed' | 'recognizing' | 'translating' | 'done';

/** 展示的一個 Page：pageHash 是 side panel 與覆蓋層 hover 同步用的身分。 */
export interface DemoViewPage {
  pageHash: string;
  text: PageText;
}

/**
 * 每一步停多久才進下一步。翻譯中要讓光帶照閱讀順序掃過每一句（WASH_STAGGER_MS 錯開，page-outlines.ts）至少一輪，
 * 所以停得比辨識久；加起來 3～4 秒，看得到「翻譯中」又不用等太久。
 */
const STEPS: Partial<Record<DemoPhase, { phase: DemoPhase; afterMs: number }>> = {
  recognizing: { phase: 'translating', afterMs: 700 },
  translating: { phase: 'done', afterMs: 2600 },
};

export function nextPhase(phase: DemoPhase): { phase: DemoPhase; afterMs: number } | undefined {
  return STEPS[phase];
}

/** 點外掛圖示之後的進度：沒啟動就啟動，已啟動（辨識中、翻譯中、完成）就停止並關掉 side panel。 */
export function clickIcon(phase: DemoPhase): DemoPhase {
  return phase === 'closed' ? 'recognizing' : 'closed';
}

export interface DemoView {
  panelOpen: boolean;
  /** 已啟動（SidePanel 的 running）；沒啟動時 side panel 只提示點圖示。 */
  running: boolean;
  /** 給 SidePanel 的 pages。 */
  pages: PageView[];
  /** side panel 底部的剩餘免費頁數。 */
  remaining: number;
  /** 翻譯中：頁面上每一句有光帶掃過（外掛的翻譯中外圈，#285）。 */
  washing: boolean;
  /** 頁面上畫譯文（與 hover tooltip）。 */
  overlay: boolean;
}

const untranslated = (text: PageText): PageText => ({
  balloons: text.balloons.map((b) => ({ ...b, 譯文: '' })),
  looseText: text.looseText.map((l) => ({ ...l, 譯文: '' })),
});

function transcript(phase: DemoPhase, text: PageText): PageView['transcript'] {
  if (phase === 'recognizing') return { state: 'analyzing' };
  if (phase === 'translating') return { state: 'done', text: untranslated(text), translated: false, translating: true };
  return {
    state: 'done',
    text,
    translated: true,
    // 狀態列的數字是展示用的固定值
    translation: { model: CLAUDE_MODEL, latencyMs: 1600, usage: { inputTokens: 2400, outputTokens: 600, cacheReadTokens: 0, costUsd: 0.0006 }, source: 'translated' },
  };
}

export function demoView(phase: DemoPhase, demoPages: readonly DemoViewPage[]): DemoView {
  // 停止時外掛清掉這個 tab 的 Page 與覆蓋層；展示裡的額度在下一次啟動時重新從滿的開始
  if (phase === 'closed') return { panelOpen: false, running: false, pages: [], remaining: FREE_PAGES, washing: false, overlay: false };
  const pages = demoPages.map(
    ({ pageHash, text }): PageView => ({
      anchorId: 'demo',
      rect: { x: 0, y: 0, width: 0, height: 0 },
      thumbnail: '',
      pageHash,
      transcript: transcript(phase, text),
    }),
  );
  const done = phase === 'done';
  return { panelOpen: true, running: true, pages, remaining: done ? FREE_PAGES - pages.length : FREE_PAGES, washing: phase === 'translating', overlay: done };
}
