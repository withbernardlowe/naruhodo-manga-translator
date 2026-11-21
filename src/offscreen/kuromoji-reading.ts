/**
 * 讀音（ADR 0001、#195）：kuromoji.js，有沒有 API key、走哪條翻譯路徑都用它。多音字與助數詞的音便可能讀錯。
 * 字典打包在外掛的 kuromoji/dict/，用 XHR 載入（offscreen 有 XHR，SW 沒有）。
 */
import kuromoji from 'kuromoji';
import type { Reading, ReadingWord } from '../shared/page-text.ts';
import { romaji, type RomajiToken } from './romaji.ts';

const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

let tokenizer: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | undefined;

function loadTokenizer(dicPath: string): Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> {
  tokenizer ??= new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t)));
  });
  tokenizer.catch(() => {
    tokenizer = undefined;
  });
  return tokenizer;
}

const ALL_KANJI = /^[一-鿿々〆ヶ]+$/;
const ENDS_WITH_KANJI = /[一-鿿々〆ヶ]$/;

const known =(s: string | undefined) => (s && s !== '*' ? s : undefined);

/** 送假名可能是的假名：五段的い段、一段的い段與え段。 */
const OKURIGANA = [...'きぎしじちにひびみりいけげせぜてでねへべめれえ'];

/**
 * 字典沒收的漢字（UNKNOWN、沒有讀音），多半是省略送假名的複合詞（吹出口、受付、取扱）：
 * 補上一個送假名，字典認得成動詞連用形（吹き → フキ），就拿那個讀音。每個漢字都要查得到才算。
 */
function okuriganaOmitted(
  t: kuromoji.Tokenizer<kuromoji.IpadicFeatures>,
  surface: string,
): { reading: string; pronunciation: string } | undefined {
  if (!ALL_KANJI.test(surface)) return undefined;
  let reading = '';
  let pronunciation = '';
  for (const kanji of surface) {
    const verb = OKURIGANA.map((kana) => t.tokenize(kanji + kana))
      .filter((ts) => ts.length === 1)
      .map(([only]) => only)
      .find((w) => w?.pos === '動詞' && w.conjugated_form === '連用形' && known(w.reading));
    if (!verb?.reading) return undefined;
    reading += verb.reading;
    pronunciation += known(verb.pronunciation) ?? verb.reading;
  }
  return { reading, pronunciation };
}

/**
 * kuromoji 的詞，整理成我們用的樣子。IPADIC 把踊り字「々」切成沒有讀音的記號（只々 → 只／々）：
 * 併進前一個詞，讀音重複一次（ただただ），ルビ與羅馬拼音才不會漏掉。
 */
function words(t: kuromoji.Tokenizer<kuromoji.IpadicFeatures>, tokens: kuromoji.IpadicFeatures[]): RomajiToken[] {
  const out: RomajiToken[] = [];
  for (const token of tokens) {
    const prev = out.at(-1);
    if (token.surface_form === '々' && prev?.reading) {
      prev.surface += '々';
      prev.reading += prev.reading;
      if (prev.pronunciation) prev.pronunciation += prev.pronunciation;
      continue;
    }
    const guessed = token.word_type === 'UNKNOWN' && !known(token.reading) ? okuriganaOmitted(t, token.surface_form) : undefined;
    const reading = known(token.reading) ?? guessed?.reading;
    const pronunciation = known(token.pronunciation) ?? guessed?.pronunciation;
    out.push({
      surface: token.surface_form,
      pos: token.pos,
      posDetail1: token.pos_detail_1,
      ...(reading ? { reading } : {}),
      ...(pronunciation ? { pronunciation } : {}),
    });
  }
  return out;
}

/** 回傳「原文 → 整句平假名、每個詞的讀音＋羅馬拼音」的函式：同一次斷詞一起算，羅馬拼音要看詞性（romaji.ts）。 */
export async function createKuromojiReading(dicPath: string): Promise<(ja: string) => Reading> {
  const t = await loadTokenizer(dicPath);
  return (ja) => {
    const tokens = words(t, t.tokenize(ja));
    const 讀音分詞: ReadingWord[] = [];
    for (const token of tokens) {
      // 沒有讀音的詞（記號、數字、字典沒收的字）照原文
      const word = { 原文: token.surface, 讀音: token.reading ? toHiragana(token.reading) : token.surface };
      const prev = 讀音分詞.at(-1);
      // 漢字的接尾詞（洋菓子＋屋、人生＋観、千＋円）跟前面的漢字合成一段ルビ，讀起來是一個詞
      if (prev && token.pos === '名詞' && token.posDetail1 === '接尾' && ALL_KANJI.test(word.原文) && ENDS_WITH_KANJI.test(prev.原文)) {
        prev.原文 += word.原文;
        prev.讀音 += word.讀音;
      } else 讀音分詞.push(word);
    }
    return {
      讀音: 讀音分詞.map((w) => w.讀音).join(''),
      讀音分詞,
      羅馬拼音: romaji(tokens),
    };
  };
}
