import { describe, expect, it } from 'vitest';
import { transcriptRows } from './transcript-rows.ts';

/** 自編的一頁（墓地場景）：五塊墓碑、一個小字是框外文字，三個泡泡。 */
const line = (id: string, order: number, loose: boolean, unreadable = false) => ({ id, order, loose, unreadable });
const GRAVEYARD = [
  line('b1', 7, false),
  line('b2', 8, false),
  line('b3', 9, false),
  line('l1', 1, true),
  line('l2', 2, true, true),
  line('l3', 3, true, true),
  line('l4', 4, true, true),
  line('l5', 5, true),
  line('l6', 6, true, true),
];
const ids = (lines: { id: string }[]) => lines.map((l) => l.id);

describe('transcriptRows：框外文字的無法辨識收到這頁最後（U17）', () => {
  it('能讀的句子照閱讀順序留在原位，框外的無法辨識照閱讀順序收進收合列', () => {
    const rows = transcriptRows(GRAVEYARD, { translated: true, expanded: false, hoveredId: undefined });
    expect(ids(rows.inline)).toEqual(['l1', 'l5', 'b1', 'b2', 'b3']);
    expect(ids(rows.folded)).toEqual(['l2', 'l3', 'l4', 'l6']);
  });

  it('泡泡讀不出來時留在原位：幾乎都是對白，少一句讀者要看得到', () => {
    const lines = [line('b1', 1, false), line('b2', 2, false, true), line('l1', 3, true, true)];
    const rows = transcriptRows(lines, { translated: true, expanded: false, hoveredId: undefined });
    expect(ids(rows.inline)).toEqual(['b1', 'b2']);
    expect(ids(rows.folded)).toEqual(['l1']);
  });

  it('還沒翻好時不收：unreadable 要等翻譯回來才算數', () => {
    const rows = transcriptRows(GRAVEYARD, { translated: false, expanded: false, hoveredId: undefined });
    expect(ids(rows.inline)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'b1', 'b2', 'b3']);
    expect(rows.folded).toEqual([]);
  });

  it('收起時收合列裡不露出任何一行', () => {
    const rows = transcriptRows(GRAVEYARD, { translated: true, expanded: false, hoveredId: 'b1' });
    expect(rows.revealed).toEqual([]);
  });

  it('收起時頁面 hover 到收起的段：只露出那一行，不整個展開', () => {
    const rows = transcriptRows(GRAVEYARD, { translated: true, expanded: false, hoveredId: 'l4' });
    expect(ids(rows.revealed)).toEqual(['l4']);
  });

  it('展開時全部露出', () => {
    const rows = transcriptRows(GRAVEYARD, { translated: true, expanded: true, hoveredId: 'l4' });
    expect(ids(rows.revealed)).toEqual(['l2', 'l3', 'l4', 'l6']);
  });
});
