/**
 * Romaji（羅馬拼音，GLOSSARY）：kuromoji 斷好的詞 → 一句修正平文式羅馬字。
 * 斷詞與助詞要看詞性，所以只能在 kuromoji 分析的當下算，不能從整句讀音事後轉。
 */
import type { RomajiWord } from '../shared/page-text.ts';

/** kuromoji 一個詞裡用得到的欄位。reading／pronunciation 是片假名；字典沒有的詞（ぱち）兩個都沒有。 */
export interface RomajiToken {
  surface: string;
  pos: string;
  posDetail1: string;
  reading?: string;
  pronunciation?: string;
}

const KANA: Record<string, string> = {
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o',
  カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
  サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so',
  タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
  ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no',
  ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
  マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo',
  ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
  ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro',
  ワ: 'wa', ヰ: 'i', ヱ: 'e', ヲ: 'o', ン: 'n',
  ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
  ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
  ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
  バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
  パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po',
  ヴ: 'vu',
  ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o', ャ: 'ya', ュ: 'yu', ョ: 'yo', ヮ: 'wa',
};

/** 兩個假名合成一個音（キャ、シェ、ファ、ティ…）。 */
const DIGRAPH: Record<string, string> = {
  キャ: 'kya', キュ: 'kyu', キョ: 'kyo', ギャ: 'gya', ギュ: 'gyu', ギョ: 'gyo',
  シャ: 'sha', シュ: 'shu', ショ: 'sho', シェ: 'she', ジャ: 'ja', ジュ: 'ju', ジョ: 'jo', ジェ: 'je',
  チャ: 'cha', チュ: 'chu', チョ: 'cho', チェ: 'che', ヂャ: 'ja', ヂュ: 'ju', ヂョ: 'jo',
  ニャ: 'nya', ニュ: 'nyu', ニョ: 'nyo', ヒャ: 'hya', ヒュ: 'hyu', ヒョ: 'hyo',
  ビャ: 'bya', ビュ: 'byu', ビョ: 'byo', ピャ: 'pya', ピュ: 'pyu', ピョ: 'pyo',
  ミャ: 'mya', ミュ: 'myu', ミョ: 'myo', リャ: 'rya', リュ: 'ryu', リョ: 'ryo',
  ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo', フュ: 'fyu',
  ティ: 'ti', ディ: 'di', トゥ: 'tu', ドゥ: 'du', デュ: 'dyu', テュ: 'tyu',
  ウィ: 'wi', ウェ: 'we', ウォ: 'wo', ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo',
  ツァ: 'tsa', ツィ: 'tsi', ツェ: 'tse', ツォ: 'tso', イェ: 'ye',
};

const MACRON: Record<string, string> = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };

/** 標點：黏在前一個詞後面。其他記號（括號、引號）不寫。 */
const PUNCTUATION: Record<string, string> = {
  '、': ',', '，': ',', ',': ',', '。': '.', '．': '.', '.': '.', '？': '?', '?': '?', '！': '!', '!': '!',
  '…': '…', '‥': '…', '〜': '~', '～': '~', '~': '~',
};

/**
 * 整個詞都是標點時的寫法。看字元不看詞性：IPADIC 把半形的 ? ! ~ . 當成名詞，連續的（!? ......）也是一個詞。
 */
function punctuation(surface: string): string | undefined {
  const marks = [...surface].map((c) => PUNCTUATION[c]);
  return marks.every((m) => m !== undefined) ? marks.join('') : undefined;
}

/** IPADIC 把拉長音的「ー」（かわいー、すげー）切成自己一個詞、沒有讀音：拉長前一個詞的最後一個母音。 */
const LONG_VOWEL = /^ー+$/;

/** 助詞照發音寫。 */
const PARTICLE: Record<string, string> = { は: 'wa', へ: 'e', を: 'o' };

const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const isKana = (s: string) => /^[ァ-ヺー]+$/.test(s);
const VOWEL_END = /[aiueo]$/;

/** 促音記號：還不知道下一個子音時先留著（詞尾的「待っ」要等下一個詞「て」），接上時由 joinSokuon 換掉。 */
const SOKUON = 'ッ';

/** 接上下一段：前一段結尾是促音記號就重複這一段的第一個子音（ch 前面加 t）。 */
function joinSokuon(prev: string, piece: string): string {
  if (!prev.endsWith(SOKUON)) return prev + piece;
  const head = prev.slice(0, -1);
  if (piece.startsWith('ch')) return `${head}t${piece}`;
  return /^[b-df-hj-np-tv-z]/.test(piece) ? head + piece[0] + piece : head + piece;
}

const SMALL_VOWEL = new Set(['ァ', 'ィ', 'ゥ', 'ェ', 'ォ']);

/**
 * 一個詞的片假名 → 羅馬字。pronunciation 跟 reading 一樣長時才拿來對照：發音是「ー」的位置算長音
 * （但 えい、いい 照寫：sensei、ōkii），發音是「ワ」的「ハ」寫 wa（こんにちは）；
 * 不一樣長（ヴァイオリン／バイオリン）就只看 reading。
 */
function kanaToRomaji(reading: string, pronunciation: string | undefined): string {
  const pron = pronunciation && [...pronunciation].length === [...reading].length ? [...pronunciation] : undefined;
  const chars = [...reading];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    const vowel = out.match(VOWEL_END)?.[0];
    const lengthens = c === 'ー' || (pron?.[i] === 'ー' && c !== 'イ') || (SMALL_VOWEL.has(c) && KANA[c] === vowel);
    if (lengthens) {
      if (vowel) out = out.slice(0, -1) + MACRON[vowel];
      continue;
    }
    if (c === 'ッ') {
      out += SOKUON;
      continue;
    }
    const pair = DIGRAPH[c + (chars[i + 1] ?? '')];
    const syllable = c === 'ハ' && pron?.[i] === 'ワ' ? 'wa' : (pair ?? KANA[c] ?? c);
    if (pair) i++;
    if (out.endsWith('n') && chars[i - (pair ? 2 : 1)] === 'ン' && /^[aiueoy]/.test(syllable)) out += "'";
    out = joinSokuon(out, syllable);
  }
  return out;
}

/**
 * 這個詞要黏在前一個詞後面（不另起一個詞）：助動詞、被動／使役語尾（動詞・接尾）、
 * て／で／ちゃ／じゃ，以及口語的 てる、ちゃう 這類補助動詞。前一個詞以促音結尾時也一定接著念（romaji()）。
 */
const joinsPrevious = (token: RomajiToken) =>
  token.pos === '助動詞' ||
  (token.pos === '動詞' && token.posDetail1 === '接尾') ||
  (token.pos === '動詞' && token.posDetail1 === '非自立' && /^(て|で|ちゃ|じゃ|っ|ッ)/.test(token.surface)) ||
  (token.pos === '助詞' && token.posDetail1 === '接続助詞' && /^(て|で|ちゃ|じゃ)$/.test(token.surface));

function tokenRomaji(token: RomajiToken): string {
  if (token.pos === '助詞' && PARTICLE[token.surface]) return PARTICLE[token.surface]!;
  const kana = token.reading ?? toKatakana(token.surface);
  if (isKana(kana)) return kanaToRomaji(kana, token.pronunciation);
  // 字典沒收、中間有「・」的片假名名字（エイモス・チュツオーラ）整個是一個詞：拆開各自轉
  const parts = kana.split('・').filter((p) => p !== '');
  if (parts.length > 1 && parts.every(isKana)) return parts.map((p) => kanaToRomaji(p, undefined)).join(' ');
  return token.surface;
}

/** 開括號、開引號：不寫進羅馬拼音，原文接到下一個詞前面（「本」 整個是一個詞）。 */
const OPENING = /^[「『（(［[【〈《“‘｛{〔]+$/;

/**
 * 一句按詞的原文與羅馬拼音（#330 hover 兩邊一起亮）：詞的切法就是 romaji() 決定空格的單位，
 * 黏在前一個詞的（助動詞、て、促音、標點、拉長音）原文也一起黏上。原文接起來等於整句原文；
 * 沒有羅馬拼音的詞（空白、句尾落單的記號）羅馬拼音是空字串。
 */
export function romajiWords(tokens: readonly RomajiToken[]): RomajiWord[] {
  const words: RomajiWord[] = [];
  // 開括號：等下一個詞來了接在它前面
  let pending = '';
  // 上一個詞不能再接東西：標點與拉長音之後另起一個詞（買えない?なんで → kaenai? na）；
  // 自己一個詞的助詞後面也不接（それはない：IPADIC 把 ない 當助動詞，但不能寫成 wanai）
  let closed = false;
  /** 原文接到上一個詞（沒有上一個詞就自己一個、沒有羅馬拼音）。 */
  const attach = (surface: string) => {
    const last = words.at(-1);
    if (last) last.原文 += pending + surface;
    else words.push({ 原文: pending + surface, 羅馬拼音: '' });
    pending = '';
  };
  const push = (surface: string, latin: string) => {
    words.push({ 原文: pending + surface, 羅馬拼音: latin });
    pending = '';
  };
  for (const token of tokens) {
    const last = words.at(-1);
    const mark = punctuation(token.surface);
    if (mark !== undefined) {
      // 句首的標點（......いつまで）自己一個詞
      if (last) {
        attach(token.surface);
        last.羅馬拼音 += mark;
      } else push(token.surface, mark);
      closed = true;
      continue;
    }
    if (token.pos === '記号') {
      if (token.posDetail1 === '空白') push(token.surface, '');
      else if (OPENING.test(token.surface)) pending += token.surface;
      else attach(token.surface);
      continue;
    }
    if (LONG_VOWEL.test(token.surface)) {
      const vowel = closed ? undefined : last?.羅馬拼音.match(VOWEL_END)?.[0];
      attach(token.surface);
      if (vowel) last!.羅馬拼音 = last!.羅馬拼音.slice(0, -1) + MACRON[vowel];
      // 拉長音是語氣停在這裡，後面另起一個詞（すげーな：IPADIC 把 な 當助動詞，但不能寫成 sugēna）
      closed = true;
      continue;
    }
    const piece = tokenRomaji(token);
    const prev = last?.羅馬拼音;
    if (prev !== undefined && prev !== '' && !closed && (joinsPrevious(token) || prev.endsWith(SOKUON))) {
      attach(token.surface);
      // 行こ＋う：跨詞的 o＋u 也是長音
      last!.羅馬拼音 = token.pos === '助動詞' && piece === 'u' && prev.endsWith('o') ? prev.slice(0, -1) + 'ō' : joinSokuon(prev, piece);
      closed = false;
    } else {
      push(token.surface, piece);
      closed = token.pos === '助詞';
    }
  }
  if (pending) attach('');
  return words.map((w) => ({ 原文: w.原文, 羅馬拼音: w.羅馬拼音.replaceAll(SOKUON, '').toLowerCase() }));
}

/** 按詞的羅馬拼音接成一句：詞與詞空一格（沒有羅馬拼音的詞跳過）。 */
export const joinRomaji = (words: readonly RomajiWord[]): string =>
  words
    .map((w) => w.羅馬拼音)
    .filter((w) => w !== '')
    .join(' ');

/** 一句的羅馬拼音：詞與詞空一格，標點黏前面，全部小寫。 */
export const romaji = (tokens: readonly RomajiToken[]): string => joinRomaji(romajiWords(tokens));
