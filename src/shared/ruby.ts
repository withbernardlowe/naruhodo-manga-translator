/**
 * 振り仮名（spec #27 第 8 節、prototype/sidepanel-ui 的 alignRuby）：把讀音用「漢字段／假名段」對齊回每段漢字；
 * 有 kuromoji 每個詞的讀音時一個詞一個詞對（alignWords），沒有（舊快取）才整句對。
 * 讀音是 kuromoji 推測的（ADR 0001），不是頁面上印的ルビ。
 */
import type { ReadingWord } from './page-text.ts';

export interface RubySegment {
  text: string;
  /** 只有漢字段有。 */
  rt?: string;
}

const KANJI = /[一-鿿々〆ヶ]/;
const SPACE = /\s/;
/** 寬鬆比對時再忽略標點符號（舊快取裡 LLM 給的讀音常把 !? … 拿掉）。只在嚴格比對失敗時用：標點也是段落的分界。 */
const SPACE_OR_PUNCT = /[\s\p{P}\p{S}]/u;

const kata2hira = (c: string) => (/[ァ-ヶ]/.test(c) ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Segment = { text: string; kanji: boolean };

function match(segments: Segment[], reading: string, ignored: RegExp): RubySegment[] | null {
  const strip = (s: string) => [...s].filter((c) => !ignored.test(c));
  // 讀音去掉忽略的字元後逐字（code point）對應原本的字；平假名化只是為了比對
  const kept = strip(reading);
  const nonKanji = segments.map((s) => (s.kanji ? [] : strip(s.text).map(kata2hira)));
  const pattern = segments.map((s, i) => (s.kanji ? '(.+?)' : escape(nonKanji[i]!.join('')))).join('');
  const m = new RegExp(`^${pattern}$`, 'u').exec(kept.map(kata2hira).join(''));
  if (!m) return null;
  let group = 1;
  let cursor = 0;
  return segments.map((s, i) => {
    if (!s.kanji) {
      cursor += nonKanji[i]!.length;
      return { text: s.text };
    }
    const length = [...m[group++]!].length;
    const rt = kept.slice(cursor, cursor + length).join('');
    cursor += length;
    return { text: s.text, rt };
  });
}

/**
 * 對上 → 每段（漢字段帶 rt，保留讀音原本的平假名／片假名）；沒有漢字 → 整句一段、沒有 rt；
 * 對不上（例如數字在讀音裡寫成假名）→ null，呼叫端退回顯示整句讀音。
 */
export function alignRuby(ja: string, reading: string): RubySegment[] | null {
  const segments: Segment[] = [];
  for (const c of ja) {
    const kanji = KANJI.test(c);
    const last = segments.at(-1);
    if (last && last.kanji === kanji) last.text += c;
    else segments.push({ text: c, kanji });
  }
  if (!segments.some((s) => s.kanji)) return [{ text: ja }];
  return match(segments, reading, SPACE) ?? match(segments, reading, SPACE_OR_PUNCT);
}

/** side panel 與頁面 tooltip 怎麼顯示一句：分段（漢字段帶ルビ），或對不上時原文＋整句讀音（fallback）。 */
export type RubyDisplay = { segments: RubySegment[] } | { fallback: string };

/**
 * 照 kuromoji 的詞一個一個對齊：相鄰兩個詞的漢字（写真＋撮っ）各自帶讀音，讀音裡碰巧有的假名（万能の「の」）
 * 也不會被當成分界。某個詞自己對不上（數字讀成假名）就整個詞帶讀音；詞接起來不是原文（舊資料）→ null。
 */
function alignWords(ja: string, words: readonly ReadingWord[]): RubySegment[] | null {
  if (words.map((w) => w.原文).join('') !== ja) return null;
  const segments: RubySegment[] = [];
  for (const word of words) {
    const aligned = KANJI.test(word.原文) && word.讀音 !== word.原文 ? (alignRuby(word.原文, word.讀音) ?? [{ text: word.原文, rt: word.讀音 }]) : [{ text: word.原文 }];
    for (const segment of aligned) {
      const last = segments.at(-1);
      // 沒有ルビ的段接起來，跟整句對齊的結果長得一樣
      if (segment.rt === undefined && last && last.rt === undefined) last.text += segment.text;
      else segments.push({ ...segment });
    }
  }
  return segments;
}

/** 沒有讀音＝原文一段、沒有ルビ；有每個詞的讀音就照詞對齊；對不上＝fallback 整句讀音。 */
export function rubyDisplay(ja: string, reading: string, words?: readonly ReadingWord[]): RubyDisplay {
  if (!reading) return { segments: [{ text: ja }] };
  const segments = (words && alignWords(ja, words)) ?? alignRuby(ja, reading);
  return segments ? { segments } : { fallback: reading };
}