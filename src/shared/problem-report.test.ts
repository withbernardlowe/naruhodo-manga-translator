import { describe, expect, it } from 'vitest';
import type { PageView } from './messages.ts';
import type { BalloonText, LooseText, PageText } from './page-text.ts';
import { problemReport, type ProblemReportInput } from './problem-report.ts';

const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };

function balloon(order: number, 原文: string, 譯文: string, more: Partial<BalloonText> = {}): BalloonText {
  return {
    id: `b${order}`,
    order,
    balloonBbox: box,
    textBbox: box,
    orientation: 'vertical',
    原文,
    讀音: '',
    讀音來源: 'kuromoji',
    譯文,
    unreadable: false,
    ...more,
  };
}

function loose(order: number, 原文: string, 譯文: string, more: Partial<LooseText> = {}): LooseText {
  return { id: `l${order}`, order, bbox: box, orientation: 'horizontal', 原文, 讀音: '', 讀音來源: 'kuromoji', 譯文, unreadable: false, ...more };
}

function page(pageHash: string, text: PageText, more: Partial<PageView> = {}): PageView {
  return {
    anchorId: 'a1',
    pageHash,
    rect: { x: 0, y: 0, width: 800, height: 1200 },
    thumbnail: 'data:image/jpeg;base64,THUMB',
    transcript: { state: 'done', text, translated: true, translation: { source: 'translated', model: 'claude-test', latencyMs: 1200, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, costUsd: 0.001 } } },
    ...more,
  };
}

const input = (pages: PageView[], more: Partial<ProblemReportInput> = {}): ProblemReportInput => ({
  extensionVersion: '0.2.5',
  userAgent: 'Mozilla/5.0 Test',
  translationMode: 'hosted',
  pageMode: 'read',
  modelStatus: { state: 'ready', executionProvider: 'webgpu', threads: 4 },
  pages,
  context: { pages: [] },
  ...more,
});

/** 報告最後 <details> 裡的 JSON。 */
function reportJson(report: string) {
  const json = /```json\n([\s\S]*?)\n```/.exec(report)?.[1];
  if (json === undefined) throw new Error('報告裡沒有 JSON 區塊');
  return JSON.parse(json);
}

describe('給人看的部分', () => {
  it('每句一行：編號（第幾頁、閱讀順序）、原文 → 譯文；Balloon 與 Loose Text 照閱讀順序排在一起', () => {
    const report = problemReport(
      input([
        page('h1', { balloons: [balloon(1, 'おはよう', '早安'), balloon(3, 'またね', '再見')], looseText: [loose(2, 'ドン', '咚')] }),
        page('h2', { balloons: [balloon(1, 'はい', '是')], looseText: [] }),
      ]),
    );

    expect(report).toContain('- P1-L1 對話框：おはよう → 早安\n- P1-L2 框外文字：ドン → 咚\n- P1-L3 對話框：またね → 再見');
    expect(report).toContain('- P2-L1 對話框：はい → 是');
  });

  it('無法辨識、沒有譯文的句子標出來，不留空的箭頭', () => {
    const report = problemReport(
      input([page('h1', { balloons: [balloon(1, 'ぁぃ', '', { unreadable: true }), balloon(2, 'うん', '')], looseText: [] })]),
    );

    expect(report).toContain('- P1-L1 對話框：ぁぃ（無法辨識）\n- P1-L2 對話框：うん（未翻譯）');
  });
});

describe('給 agent 的 JSON', () => {
  it('環境、這頁的翻譯紀錄（含快取裡的 prompt 版本與用到的 Series Notes）、每句的辨識數字', () => {
    const report = problemReport(
      input(
        [
          page('h1', {
            balloons: [balloon(1, 'おはよう', '早安', { 讀音: 'おはよう', ocrConfidence: 0.91234, ocrDropped: '…', textBbox: { x: 0.12345, y: 0.2, w: 0.1, h: 0.05 } })],
            looseText: [loose(2, 'ドン', '咚', { sfx: true, eraseLuminance: 240 })],
          }),
        ],
        {
          context: {
            pageUrl: 'https://manga.example/read/1',
            zoom: 1.25,
            viewport: { width: 1280, height: 720 },
            devicePixelRatio: 1.5,
            seriesName: '虛構作品',
            pages: [{ pageHash: 'h1', promptVersion: 'p7', translatedAt: Date.UTC(2026, 10, 15, 3, 4, 5), usedNotes: [{ 原文: '太郎', 譯文: '太郎' }] }],
          },
        },
      ),
    );

    const json = reportJson(report);
    expect(json).toMatchObject({
      extensionVersion: '0.2.5',
      userAgent: 'Mozilla/5.0 Test',
      translationMode: 'hosted',
      pageMode: 'read',
      ocr: { state: 'ready', executionProvider: 'webgpu', threads: 4 },
      pageUrl: 'https://manga.example/read/1',
      zoom: 1.25,
      viewport: { width: 1280, height: 720 },
      devicePixelRatio: 1.5,
      series: '虛構作品',
    });
    expect(json.pages[0]).toEqual({
      id: 'P1',
      pageHash: 'h1',
      rect: { x: 0, y: 0, width: 800, height: 1200 },
      state: 'done',
      translation: { source: 'translated', model: 'claude-test', latencyMs: 1200 },
      promptVersion: 'p7',
      translatedAt: '2026-11-15T03:04:05.000Z',
      usedNotes: [{ 原文: '太郎', 譯文: '太郎' }],
      lines: [
        {
          id: 'P1-L1',
          kind: 'balloon',
          orientation: 'vertical',
          balloonBbox: [0.1, 0.2, 0.3, 0.1],
          textBbox: [0.123, 0.2, 0.1, 0.05],
          原文: 'おはよう',
          讀音: 'おはよう',
          譯文: '早安',
          unreadable: false,
          ocrConfidence: 0.912,
          ocrDropped: '…',
        },
        { id: 'P1-L2', kind: 'loose', orientation: 'horizontal', bbox: [0.1, 0.2, 0.3, 0.1], 原文: 'ドン', 讀音: '', 譯文: '咚', unreadable: false, sfx: true, eraseLuminance: 240 },
      ],
    });
  });

  it('沒有任何圖片：Page 縮圖、擦除小圖都是截圖切出來的，不能跟著貼到公開的 Discussion', () => {
    const erase = { box, image: 'data:image/png;base64,ERASE', fit: box };
    const report = problemReport(
      input([
        page('h1', {
          balloons: [balloon(1, 'おはよう', '早安', { erase })],
          looseText: [loose(2, 'ドン', '咚', { erase: { box, image: 'data:image/png;base64,LOOSE' } })],
        }),
      ]),
    );

    expect(report).not.toMatch(/data:image|THUMB|ERASE|LOOSE/);
  });

  it('還在辨識、出錯的頁也列出來，只有狀態', () => {
    const json = reportJson(
      problemReport(input([page('h1', { balloons: [], looseText: [] }, { transcript: { state: 'error', message: 'OCR 失敗' } }), page('h2', { balloons: [], looseText: [] }, { transcript: { state: 'analyzing' } })])),
    );

    expect(json.pages.map((p: { id: string; state: string; error?: string }) => [p.id, p.state, p.error])).toEqual([
      ['P1', 'error', 'OCR 失敗'],
      ['P2', 'analyzing', undefined],
    ]);
  });
});
