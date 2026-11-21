/**
 * 羅馬拼音按詞對應（#330）：side panel 與頁面 tooltip 把原文與羅馬拼音都切成詞，hover 一邊的詞兩邊一起亮。
 * 詞的切法是羅馬拼音的詞（romajiWords，助動詞、て、標點黏在前一個詞）；振り仮名照 rubyDisplay 對齊後，
 * 再按詞的邊界分到每個詞。不能反過來用ルビ的段切詞：疲｜れた、待｜ってください 會把詞切斷。
 */
import type { RomajiWord } from './page-text.ts';
import type { RubyDisplay, RubySegment } from './ruby.ts';

/** 一個可以 hover 的詞：原文的段（漢字段帶ルビ）與它的羅馬拼音。羅馬拼音是空字串的（空白）不亮。 */
export interface WordUnit {
  segments: RubySegment[];
  羅馬拼音: string;
}

/**
 * 原文按羅馬拼音的詞切成單位。display＝rubyDisplay 的結果；沒有（不顯示ルビ）或對不上（fallback）就只切原文、沒有ルビ。
 * 一段ルビ跨兩個詞（漢字接尾詞：不動産＋屋 是一段ルビ、兩個羅馬拼音的詞）不能拆開讀音：那幾個詞合成一個單位。
 * 沒有詞資料（舊快取補算不了）或詞接起來不是原文 → null，呼叫端退回整句一行。
 */
export function wordUnits(ja: string, display: RubyDisplay | undefined, words: readonly RomajiWord[] | undefined): WordUnit[] | null {
  if (!words || words.map((w) => w.原文).join('') !== ja) return null;
  const segments = display && 'segments' in display ? display.segments : [{ text: ja }];
  if (segments.map((s) => s.text).join('') !== ja) return null;

  // 每個詞在原文裡的 [開始, 結束)；被同一段ルビ蓋到的詞併成一組
  const groups: { start: number; end: number; romaji: string[] }[] = [];
  let offset = 0;
  for (const word of words) {
    groups.push({ start: offset, end: offset + word.原文.length, romaji: [word.羅馬拼音] });
    offset += word.原文.length;
  }
  offset = 0;
  for (const segment of segments) {
    const start = offset;
    const end = (offset += segment.text.length);
    if (segment.rt === undefined) continue;
    const first = groups.findIndex((g) => g.end > start);
    let last = first;
    while (groups[last]!.end < end) last++;
    if (last === first) continue;
    const merged = groups.splice(first, last - first + 1);
    groups.splice(first, 0, { start: merged[0]!.start, end: merged.at(-1)!.end, romaji: merged.flatMap((g) => g.romaji) });
  }

  // 每組拿它範圍裡的段；沒有ルビ的段在邊界切開
  return groups.map(({ start, end, romaji }) => {
    const own: RubySegment[] = [];
    let at = 0;
    for (const segment of segments) {
      const s = at;
      const e = (at += segment.text.length);
      if (e <= start || s >= end) continue;
      own.push(segment.rt === undefined ? { text: segment.text.slice(Math.max(start, s) - s, Math.min(end, e) - s) } : segment);
    }
    return { segments: own, 羅馬拼音: romaji.filter((r) => r !== '').join(' ') };
  });
}
