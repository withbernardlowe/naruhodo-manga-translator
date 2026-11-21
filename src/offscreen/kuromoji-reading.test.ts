/**
 * 真的 kuromoji 字典（node_modules/kuromoji/dict/）跑一遍：讀音、ルビ對齊、羅馬拼音。
 * 句子取自真實漫畫裡讀錯或排錯的對白；romaji.test.ts 是照抄 token 的規則測試，這裡驗證整條路（斷詞 → 讀音 → 顯示）。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Reading } from '../shared/page-text.ts';
import { rubyDisplay } from '../shared/ruby.ts';
import { createKuromojiReading } from './kuromoji-reading.ts';

let read: (ja: string) => Reading;
beforeAll(async () => {
  read = await createKuromojiReading('node_modules/kuromoji/dict/');
});

/** ルビ寫成「漢字(讀音)」方便比對；對不上時是【整句讀音】。 */
function ruby(ja: string): string {
  const r = read(ja);
  const display = rubyDisplay(ja, r.讀音, r.讀音分詞);
  return 'segments' in display ? display.segments.map((s) => (s.rt ? `${s.text}(${s.rt})` : s.text)).join('') : `【${display.fallback}】`;
}

describe('ルビ照 kuromoji 的詞對齊', () => {
  it('相鄰兩個詞的漢字各自帶讀音，不合成一段', () => {
    expect(ruby('お店の写真撮っていいですかー?')).toBe('お店(みせ)の写真(しゃしん)撮(と)っていいですかー?');
    expect(ruby('体壊してまで余分な金貰うよりは実際気楽だ')).toBe('体(からだ)壊(こわ)してまで余分(よぶん)な金(きん)貰(もら)うよりは実際(じっさい)気楽(きらく)だ');
    expect(ruby('生涯独身でいらしたそうで')).toBe('生涯(しょうがい)独身(どくしん)でいらしたそうで');
  });

  it('數字後面的漢字不跟下一個詞黏在一起', () => {
    expect(ruby('6年古本屋やってると')).toBe('6年(ねん)古本屋(ふるほんや)やってると');
    expect(ruby('2階終わり!')).toBe('2階(かい)終(お)わり!');
  });

  it('漢字的接尾詞跟前面的漢字合成一段', () => {
    expect(ruby('不動産屋さん')).toBe('不動産屋(ふどうさんや)さん');
    expect(ruby('価値観と住環境')).toBe('価値観(かちかん)と住環境(じゅうかんきょう)');
    expect(ruby('3千円でも')).toBe('3千円(せんえん)でも');
  });

  it('讀音裡碰巧有「の」時不對錯位置', () => {
    expect(ruby('全知全能の神')).toBe('全知全能(ぜんちぜんのう)の神(かみ)');
  });

  it('字典沒收的漢字（省略送假名的複合詞）也有讀音，不把漢字寫進羅馬拼音', () => {
    expect(ruby('巣は地脈の吹出口に多いんだ')).toContain('の吹(ふき)出口(でぐち)に');
    expect(read('巣は地脈の吹出口に多いんだ').羅馬拼音).toContain('no fuki deguchi ni');
  });

  it('々 讀成前一個字的讀音', () => {
    const r = read('只々本が好き');
    expect(r.讀音).toBe('ただただほんがすき');
    expect(r.羅馬拼音).toBe('tadatada hon ga suki');
    expect(ruby('只々本が好き')).toBe('只々(ただただ)本(ほん)が好(す)き');
  });
});

describe('羅馬拼音', () => {
  it('獨立成一個詞的長音「ー」拉長前一個母音', () => {
    expect(read('えーかわいー').羅馬拼音).toBe('ē kawaī');
    expect(read('すげーなこの人').羅馬拼音).toBe('sugē na kono hito');
  });

  it('半形 ? ! ~ . 當標點：黏在前一個詞後面，下一個詞另起', () => {
    expect(read('え?買えない?なんで?').羅馬拼音).toBe('e? kaenai? na nde?');
    expect(read('まずは2階!').羅馬拼音).toBe('mazuwa 2 kai!');
    expect(read('え~~').羅馬拼音).toBe('e~~');
    expect(read('金とったろか......').羅馬拼音).toBe('kin tottaro ka......');
    expect(read('......いつまで').羅馬拼音).toBe('...... itsu made');
  });

  it('中間有「・」的片假名名字也轉成羅馬字', () => {
    expect(read('ジョン・スミス!').羅馬拼音).toBe('jon sumisu!');
  });

  it('助詞後面的助動詞不黏到助詞上', () => {
    expect(read('それはないのに').羅馬拼音).toBe('sore wa nai noni');
  });
});
