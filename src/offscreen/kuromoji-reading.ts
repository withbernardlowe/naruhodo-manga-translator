/**
 * 讀音（ADR 0001、#195）：kuromoji.js，有沒有 API key、走哪條翻譯路徑都用它。多音字與助數詞的音便可能讀錯。
 * 字典打包在外掛的 kuromoji/dict/，用 XHR 載入（offscreen 有 XHR，SW 沒有）。
 */
import kuromoji from 'kuromoji';
import type { Reading } from '../shared/page-text.ts';
import { romaji } from './romaji.ts';

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

/** 回傳「原文 → 整句平假名＋羅馬拼音」的函式：同一次斷詞算兩個，羅馬拼音要看詞性（romaji.ts）。 */
export async function createKuromojiReading(dicPath: string): Promise<(ja: string) => Reading> {
  const t = await loadTokenizer(dicPath);
  return (ja) => {
    const tokens = t.tokenize(ja);
    return {
      讀音: tokens.map((token) => (token.reading && token.reading !== '*' ? toHiragana(token.reading) : token.surface_form)).join(''),
      羅馬拼音: romaji(
        tokens.map((token) => ({
          surface: token.surface_form,
          pos: token.pos,
          posDetail1: token.pos_detail_1,
          ...(token.reading && token.reading !== '*' ? { reading: token.reading } : {}),
          ...(token.pronunciation && token.pronunciation !== '*' ? { pronunciation: token.pronunciation } : {}),
        })),
      ),
    };
  };
}
