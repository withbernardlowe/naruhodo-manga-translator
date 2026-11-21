import { describe, expect, it } from 'vitest';
import type { ModelStatus, PageView } from './messages.ts';
import type { PageText, RatioRect } from './page-text.ts';
import { pageStatus, type PageStatusInput } from './page-status.ts';

const text: PageText = { balloons: [], looseText: [] };

function page(anchorId: string, pageHash: string, transcript: PageView['transcript'], subRect?: RatioRect): PageView {
  return { anchorId, pageHash, rect: { x: 0, y: 0, width: 100, height: 140 }, thumbnail: '', transcript, ...(subRect && { subRect }) };
}

const RIGHT: RatioRect = { x: 0.5, y: 0, w: 0.5, h: 1 };
const LEFT: RatioRect = { x: 0, y: 0, w: 0.5, h: 1 };

const ready: ModelStatus = { state: 'ready', executionProvider: 'wasm', threads: 4 };

const input = (pages: PageView[], more: Partial<PageStatusInput> = {}): PageStatusInput => ({
  pages,
  model: ready,
  inLocalPipeline: new Set(),
  translating: new Set(),
  access: undefined,
  lowQuota: false,
  ...more,
});

describe('進行中', () => {
  it('本機流水線在跑這一頁：一列「辨識文字…」，標題「1 頁處理中」，圖示是 …', () => {
    expect(pageStatus(input([page('a1', 'h1', { state: 'analyzing' })], { inLocalPipeline: new Set(['h1']) }))).toEqual({
      panel: {
        header: { kind: 'working', text: '1 頁處理中' },
        current: { kind: 'single' },
        rows: [{ pageHash: 'h1', icon: { kind: 'single' }, title: '這一頁', state: { kind: 'working', text: '辨識文字…' } }],
        more: 0,
        problems: [],
        expanded: false,
      },
      badge: 'busy',
    });
  });

  it('Spread：照閱讀順序右頁先、左頁後；左頁還沒輪到是「排隊中」', () => {
    const pages = [page('a1', 'left', { state: 'analyzing' }, LEFT), page('a1', 'right', { state: 'analyzing' }, RIGHT)];

    expect(pageStatus(input(pages, { translating: new Set(['right']) })).panel).toEqual({
      header: { kind: 'working', text: '2 頁處理中' },
      current: { kind: 'spread', side: 'right' },
      rows: [
        { pageHash: 'right', icon: { kind: 'spread', side: 'right' }, title: '右頁 · 先讀', state: { kind: 'working', text: '翻譯中…' } },
        { pageHash: 'left', icon: { kind: 'spread', side: 'left' }, title: '左頁 · 後讀', state: { kind: 'queued' } },
      ],
      more: 0,
      problems: [],
      expanded: false,
    });
  });

  it('右頁翻好、換左頁：翻好的那列留著打勾，標題只算還在忙的', () => {
    const pages = [page('a1', 'right', { state: 'done', text, translated: true }, RIGHT), page('a1', 'left', { state: 'analyzing' }, LEFT)];
    const { panel } = pageStatus(input(pages, { inLocalPipeline: new Set(['left']) }));

    expect(panel?.header).toEqual({ kind: 'working', text: '1 頁處理中' });
    expect(panel?.rows.map(({ state }) => state)).toEqual([{ kind: 'done' }, { kind: 'working', text: '辨識文字…' }]);
  });

  it('收合時的位置圖示：正在處理的那頁；都還在排隊就是排在最前面的', () => {
    const pages = [page('a1', 'right', { state: 'done', text, translated: true }, RIGHT), page('a1', 'left', { state: 'analyzing' }, LEFT)];

    expect(pageStatus(input(pages, { inLocalPipeline: new Set(['left']) })).panel?.current).toEqual({ kind: 'spread', side: 'left' });
    expect(pageStatus(input(pages)).panel?.current).toEqual({ kind: 'spread', side: 'left' });
  });

  it('很多張 img：每頁用編號，照 SW 給的順序', () => {
    const pages = [page('a1', 'h1', { state: 'analyzing' }), page('a2', 'h2', { state: 'analyzing' })];

    expect(pageStatus(input(pages)).panel?.rows.map(({ icon, title }) => ({ icon, title }))).toEqual([
      { icon: { kind: 'number', n: 1 }, title: '第 1 頁' },
      { icon: { kind: 'number', n: 2 }, title: '第 2 頁' },
    ]);
  });

  it('條漫（長 Page）：一條長的圖示，「畫面上這一段」；標題不算頁數', () => {
    const strip = { ...page('a1', 'h1', { state: 'analyzing' }), stripes: [] };
    const { panel } = pageStatus(input([strip], { inLocalPipeline: new Set(['h1']) }));

    expect(panel?.header).toEqual({ kind: 'working', text: '處理中' });
    expect(panel?.rows[0]).toMatchObject({ icon: { kind: 'strip' }, title: '畫面上這一段' });
  });

  it(`超過 ${5} 頁：先拿掉前面翻好的，再從後面截掉，截掉的算進「還有 N 頁」`, () => {
    const translated = (i: number) => page(`a${i}`, `h${i}`, { state: 'done', text, translated: true });
    const analyzing = (i: number) => page(`a${i}`, `h${i}`, { state: 'analyzing' });
    const pages = [translated(1), translated(2), analyzing(3), analyzing(4), analyzing(5), analyzing(6), analyzing(7), analyzing(8)];
    const { panel } = pageStatus(input(pages));

    expect(panel?.rows.map(({ title }) => title)).toEqual(['第 3 頁', '第 4 頁', '第 5 頁', '第 6 頁', '第 7 頁']);
    expect(panel?.more).toBe(1);
    expect(panel?.header.text).toBe('6 頁處理中');
  });

  it('第一次使用、模型在下載：進度在標題（照實際進度），每一頁都在排隊', () => {
    const { panel } = pageStatus(input([page('a1', 'h1', { state: 'analyzing' })], { inLocalPipeline: new Set(['h1']), model: { state: 'downloading', loaded: 50, total: 200 } }));

    expect(panel?.header).toEqual({ kind: 'working', text: '下載文字辨識模型 25%', progress: 0.25 });
    expect(panel?.rows[0]?.state).toEqual({ kind: 'queued' });
  });

  it('模型載入中：「載入文字辨識模型…」', () => {
    const { panel } = pageStatus(input([page('a1', 'h1', { state: 'analyzing' })], { model: { state: 'loading' } }));

    expect(panel?.header).toEqual({ kind: 'working', text: '載入文字辨識模型…' });
  });

  it('按了重新翻譯（done 但 translating）：「重新翻譯中…」', () => {
    const { panel } = pageStatus(input([page('a1', 'h1', { state: 'done', text, translated: true, translating: true })]));

    expect(panel?.rows[0]?.state).toEqual({ kind: 'working', text: '重新翻譯中…' });
  });
});

describe('出問題：面板一直展開，圖示是 !', () => {
  const failedRight = page('a1', 'right', { state: 'done', text, translated: false, translateError: 'Claude API 500' }, RIGHT);

  it('一頁翻譯失敗、另一頁還在翻：標題照樣是處理中，失敗那列可以重試', () => {
    const status = pageStatus(input([failedRight, page('a1', 'left', { state: 'analyzing' }, LEFT)], { translating: new Set(['left']) }));

    expect(status.badge).toBe('problem');
    expect(status.panel?.header).toEqual({ kind: 'working', text: '1 頁處理中' });
    expect(status.panel?.rows.map(({ state }) => state)).toEqual([{ kind: 'failed' }, { kind: 'working', text: '翻譯中…' }]);
    expect(status.panel?.expanded).toBe(true);
  });

  it('翻譯失敗、其他都好了：標題換成「需要你處理」；本機流水線失敗也是同一列', () => {
    const status = pageStatus(input([failedRight, page('a1', 'left', { state: 'error', message: 'model' }, LEFT)]));

    expect(status.panel?.header).toEqual({ kind: 'problem', text: '需要你處理' });
    expect(status.panel?.rows.map(({ state }) => state)).toEqual([{ kind: 'failed' }, { kind: 'failed' }]);
  });

  it('額度用完：卡住的頁合成一列，不每頁重複；點了打開帳號頁', () => {
    const pages = [page('a1', 'h1', { state: 'done', text, translated: false, quotaExhausted: 'free' }), page('a2', 'h2', { state: 'done', text, translated: false, quotaExhausted: 'free' })];

    expect(pageStatus(input(pages))).toEqual({
      panel: {
        header: { kind: 'problem', text: '需要你處理' },
        rows: [],
        more: 0,
        problems: [{ title: '免費額度用完了', detail: '這 2 頁沒有翻', action: 'plan', label: '查看方案', pageHash: 'h1' }],
        expanded: true,
      },
      badge: 'problem',
    });
  });

  it('本月額度用完、今天全站的免費額度發完（#241）：各自的說法', () => {
    const exhausted = (quotaExhausted: 'monthly' | 'pausedToday') => pageStatus(input([page('a1', 'h1', { state: 'done', text, translated: false, quotaExhausted })])).panel?.problems;

    expect(exhausted('monthly')).toEqual([{ title: '本月額度用完了', detail: '這 1 頁沒有翻', action: 'plan', label: '查看方案', pageHash: 'h1' }]);
    expect(exhausted('pausedToday')).toEqual([{ title: '今天的免費額度已經發完', detail: '明天再試', action: 'plan', label: '查看方案', pageHash: 'h1' }]);
  });

  it('不能翻（沒登入、資料使用說明改版、沒有 API key）：合成一列，按鈕打開 onboarding 的那一步', () => {
    const problems = (access: 'signIn' | 'consent' | 'ownKey') => pageStatus(input([page('a1', 'h1', { state: 'done', text, translated: false })], { access })).panel?.problems;

    expect(problems('signIn')).toEqual([{ title: '還沒登入', detail: '這 1 頁沒有翻', action: 'signIn', label: '登入', pageHash: 'h1' }]);
    expect(problems('consent')).toEqual([{ title: '資料使用說明更新了', detail: '同意後才能繼續翻', action: 'consent', label: '查看', pageHash: 'h1' }]);
    expect(problems('ownKey')).toEqual([{ title: '還沒設定 API key', detail: '這 1 頁沒有翻', action: 'ownKey', label: '設定', pageHash: 'h1' }]);
  });

  it('一頁翻好、一頁卡在額度：翻好的那列照列，卡住的只在合併的那列', () => {
    const pages = [page('a1', 'right', { state: 'done', text, translated: true }, RIGHT), page('a1', 'left', { state: 'done', text, translated: false, quotaExhausted: 'free' }, LEFT)];
    const { panel } = pageStatus(input(pages));

    expect(panel?.rows.map(({ pageHash }) => pageHash)).toEqual(['right']);
    expect(panel?.problems.map(({ detail }) => detail)).toEqual(['這 1 頁沒有翻']);
  });
});

describe('都翻好了', () => {
  it('沒有面板，圖示是已啟動的小點', () => {
    expect(pageStatus(input([page('a1', 'h1', { state: 'done', text, translated: true })]))).toEqual({ panel: undefined, badge: 'on' });
  });

  it('沒有任何 Page（還在找、畫面上沒有完整的頁）：沒有面板', () => {
    expect(pageStatus(input([]))).toEqual({ panel: undefined, badge: 'on' });
  });

  it('能翻譯卻沒譯文（長 Page 還沒收到字）：不算問題，算翻好', () => {
    expect(pageStatus(input([page('a1', 'h1', { state: 'done', text, translated: false })]))).toEqual({ panel: undefined, badge: 'on' });
  });
});

describe('額度快用完（#237）', () => {
  const analyzing = page('a1', 'h1', { state: 'analyzing' });
  const failed = page('a2', 'h2', { state: 'error', message: 'boom' });
  const translated = page('a3', 'h3', { state: 'done', text, translated: true });

  it('平常的綠點換成橘點；翻譯中先顯示藍色，出問題仍是紅色', () => {
    expect(pageStatus(input([translated], { lowQuota: true })).badge).toBe('lowQuota');
    expect(pageStatus(input([analyzing], { lowQuota: true })).badge).toBe('busy');
    expect(pageStatus(input([analyzing, failed], { lowQuota: true })).badge).toBe('problem');
  });
});

describe('正在讀照句數計頁的 Strip（條漫，#282）', () => {
  const analyzing = page('a1', 'h1', { state: 'analyzing' });
  const translated = page('a3', 'h3', { state: 'done', text, translated: true });

  it('圓點換成「條」；快用完是橘色底的「條」；翻譯中、出問題照舊', () => {
    expect(pageStatus(input([translated], { strip: true })).badge).toBe('strip');
    expect(pageStatus(input([translated], { strip: true, lowQuota: true })).badge).toBe('stripLowQuota');
    expect(pageStatus(input([analyzing], { strip: true })).badge).toBe('busy');
  });
});
