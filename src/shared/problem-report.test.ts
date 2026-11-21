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
  displaySettings: { learnShowsTranslation: false, romaji: true },
  modelStatus: { state: 'ready', executionProvider: 'webgpu', threads: 4 },
  pages,
  context: { pages: [] },
  ...more,
});

/** 報告裡的 JSON 區塊（一行一行的原樣）。 */
function jsonBlock(report: string): string {
  const json = /```json\n([\s\S]*?)\n```/.exec(report)?.[1];
  if (json === undefined) throw new Error('報告裡沒有 JSON 區塊');
  return json;
}
const reportJson = (report: string) => JSON.parse(jsonBlock(report));

describe('報告只有除錯用的數字，沒有作品內容（會貼到公開的 Discussion）', () => {
  it('沒有對白、讀音、羅馬拼音、譯文、被丟掉的辨識文字、Series Notes 的內容', () => {
    const report = problemReport(
      input(
        [
          page('h1', {
            balloons: [balloon(1, 'おはよう', '早安', { 讀音: 'オハヨウ', 羅馬拼音: 'ohayō', ocrDropped: 'ザワ' })],
            looseText: [loose(2, 'ドン', '咚')],
          }),
        ],
        { context: { pages: [{ pageHash: 'h1', promptVersion: 'p7', translatedAt: 0, usedNoteCount: 1 }] } },
      ),
    );

    expect(report).not.toMatch(/おはよう|早安|オハヨウ|ohayō|ザワ|ドン|咚/);
  });

  it('沒有任何圖片：Page 縮圖、擦除小圖都是截圖切出來的', () => {
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
});

describe('給 agent 的 JSON', () => {
  it('環境、找得到這一頁的線索（網址、捲動位置、pageHash）、翻譯紀錄、每句的位置與辨識數字', () => {
    const report = problemReport(
      input(
        [
          page('h1', {
            balloons: [balloon(1, 'おはよう', '早安', { ocrConfidence: 0.91234, ocrDropped: 'ザワ', textBbox: { x: 0.12345, y: 0.2, w: 0.1, h: 0.05 } })],
            looseText: [loose(2, 'ドン', '', { sfx: true, eraseLuminance: 240 }), loose(3, 'ぁぃ', '', { unreadable: true })],
          }),
        ],
        {
          context: {
            pageUrl: 'https://manga.example/read/1',
            zoom: 1.25,
            view: { viewport: { width: 1280, height: 720 }, devicePixelRatio: 1.5, scroll: { y: 3000, height: 24000 } },
            pages: [{ pageHash: 'h1', promptVersion: 'p7', translatedAt: Date.UTC(2026, 10, 15, 3, 4, 5), usedNoteCount: 2 }],
          },
        },
      ),
    );

    expect(reportJson(report)).toEqual({
      extensionVersion: '0.2.5',
      userAgent: 'Mozilla/5.0 Test',
      translationMode: 'hosted',
      pageMode: 'read',
      displaySettings: { learnShowsTranslation: false, romaji: true },
      ocr: { state: 'ready', executionProvider: 'webgpu', threads: 4 },
      pageUrl: 'https://manga.example/read/1',
      zoom: 1.25,
      viewport: { width: 1280, height: 720 },
      devicePixelRatio: 1.5,
      scroll: { y: 3000, height: 24000 },
      pages: [
        {
          id: 'P1',
          pageHash: 'h1',
          rect: { x: 0, y: 0, width: 800, height: 1200 },
          state: 'done',
          translation: { source: 'translated', model: 'claude-test', latencyMs: 1200 },
          promptVersion: 'p7',
          translatedAt: '2026-11-15T03:04:05.000Z',
          usedNotes: 2,
          lines: [
            {
              id: 'P1-L1',
              kind: 'balloon',
              orientation: 'vertical',
              balloonBbox: [0.1, 0.2, 0.3, 0.1],
              textBbox: [0.123, 0.2, 0.1, 0.05],
              chars: 4,
              translated: true,
              unreadable: false,
              ocrConfidence: 0.912,
              ocrDroppedChars: 2,
            },
            { id: 'P1-L2', kind: 'loose', orientation: 'horizontal', bbox: [0.1, 0.2, 0.3, 0.1], chars: 2, translated: false, unreadable: false, sfx: true, eraseLuminance: 240 },
            { id: 'P1-L3', kind: 'loose', orientation: 'horizontal', bbox: [0.1, 0.2, 0.3, 0.1], chars: 2, translated: false, unreadable: true },
          ],
        },
      ],
    });
  });

  it('一句一行：在 GitHub 上往下掃就找得到某一句，又不像整份縮排那樣把 bbox 拆成一個數字一行', () => {
    const rows = jsonBlock(
      problemReport(
        input([
          page('h1', { balloons: [balloon(1, 'おはよう', '早安'), balloon(2, 'またね', '再見')], looseText: [] }),
          page('h2', { balloons: [], looseText: [] }, { transcript: { state: 'analyzing' } }),
        ]),
      ),
    ).split('\n');

    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatch(/^\{"extensionVersion":"0\.2\.5",.*"pages":\[$/);
    expect(rows[1]).toMatch(/^\{"id":"P1","pageHash":"h1",.*"lines":\[$/);
    expect(rows[2]).toMatch(/^\{"id":"P1-L1",.*\},$/);
    expect(rows[3]).toMatch(/^\{"id":"P1-L2",.*\}$/);
    expect(rows[4]).toBe(']},');
    expect(rows[5]).toMatch(/^\{"id":"P2","pageHash":"h2","rect":.*"state":"analyzing"\}$/);
    expect(rows[6]).toBe(']}');
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
