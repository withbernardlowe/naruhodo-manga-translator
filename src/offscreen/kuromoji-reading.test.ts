/**
 * 真的 kuromoji 字典（node_modules/kuromoji/dict/）跑一遍：讀音、ルビ對齊、羅馬拼音。
 * 句子照真實漫畫裡讀錯或排錯的對白改寫，留著同樣的詞形但不照抄原文（docs/agents/public-repo.md）；romaji.test.ts 是照抄 token 的規則測試，這裡驗證整條路（斷詞 → 讀音 → 顯示）。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Reading } from '../shared/page-text.ts';
import { rubyDisplay } from '../shared/ruby.ts';
import { wordUnits } from '../shared/word-units.ts';
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
    expect(ruby('部屋の写真撮ってもいい?')).toBe('部屋(へや)の写真(しゃしん)撮(と)ってもいい?');
    expect(ruby('体壊してまで無理な仕事受けるより気楽だ')).toBe('体(からだ)壊(こわ)してまで無理(むり)な仕事(しごと)受(う)けるより気楽(きらく)だ');
    expect(ruby('生涯現役でいたいそうで')).toBe('生涯(しょうがい)現役(げんえき)でいたいそうで');
  });

  it('數字後面的漢字不跟下一個詞黏在一起', () => {
    expect(ruby('3年八百屋やってると')).toBe('3年(ねん)八百屋(やおや)やってると');
    expect(ruby('4階全部!')).toBe('4階(かい)全部(ぜんぶ)!');
  });

  it('漢字的接尾詞跟前面的漢字合成一段', () => {
    expect(ruby('洋菓子屋さん')).toBe('洋菓子屋(ようがしや)さん');
    expect(ruby('人生観と住環境')).toBe('人生観(じんせいかん)と住環境(じゅうかんきょう)');
    expect(ruby('5千円なら')).toBe('5千円(せんえん)なら');
  });

  it('讀音裡碰巧有「の」時不對錯位置', () => {
    expect(ruby('万能の薬')).toBe('万能(ばんのう)の薬(くすり)');
  });

  it('字典沒收的漢字（省略送假名的複合詞）也有讀音，不把漢字寫進羅馬拼音', () => {
    expect(ruby('煙は山の吹出口から出る')).toContain('の吹(ふき)出口(でぐち)から');
    expect(read('煙は山の吹出口から出る').羅馬拼音).toContain('no fuki deguchi kara');
  });

  it('々 讀成前一個字的讀音', () => {
    const r = read('只々花が好き');
    expect(r.讀音).toBe('ただただはながすき');
    expect(r.羅馬拼音).toBe('tadatada hana ga suki');
    expect(ruby('只々花が好き')).toBe('只々(ただただ)花(はな)が好(す)き');
  });
});

describe('羅馬拼音', () => {
  it('獨立成一個詞的長音「ー」拉長前一個母音', () => {
    expect(read('えーおいしー').羅馬拼音).toBe('ē oishī');
    expect(read('すげーなこの店').羅馬拼音).toBe('sugē na kono mise');
  });

  it('半形 ? ! ~ . 當標點：黏在前一個詞後面，下一個詞另起', () => {
    expect(read('え?来れない?なんで?').羅馬拼音).toBe('e? korenai? na nde?');
    expect(read('まずは5番!').羅馬拼音).toBe('mazuwa 5 ban!');
    expect(read('あ~~').羅馬拼音).toBe('a~~');
    expect(read('もう帰ろか......').羅馬拼音).toBe('mō kaero ka......');
    expect(read('......どこまで').羅馬拼音).toBe('...... doko made');
  });

  it('中間有「・」的片假名名字也轉成羅馬字', () => {
    expect(read('ジョン・スミス!').羅馬拼音).toBe('jon sumisu!');
  });

  it('助詞後面的助動詞不黏到助詞上', () => {
    expect(read('これはないのに').羅馬拼音).toBe('kore wa nai noni');
  });
});

describe('羅馬拼音按詞（#330）', () => {
  const pairs = (ja: string) => read(ja).羅馬拼音分詞.map((w) => `${w.原文}=${w.羅馬拼音}`);

  it('促音、長音跨詞、助詞：一個詞對一個詞', () => {
    expect(pairs('ちょっと待ってください！')).toEqual(['ちょっと=chotto', '待って=matte', 'ください！=kudasai!']);
    expect(pairs('一緒に行こう')).toEqual(['一緒=issho', 'に=ni', '行こう=ikō']);
    expect(pairs('今日は疲れた')).toEqual(['今日=kyō', 'は=wa', '疲れた=tsukareta']);
  });

  it('原文接起來等於整句、羅馬拼音接起來等於整句羅馬拼音', () => {
    for (const ja of ['え?買えない?なんで?', '只々本が好き', '「本当に」すげーな']) {
      const r = read(ja);
      expect(r.羅馬拼音分詞.map((w) => w.原文).join('')).toBe(ja);
      expect(r.羅馬拼音分詞.map((w) => w.羅馬拼音).filter(Boolean).join(' ')).toBe(r.羅馬拼音);
    }
  });

  it('ルビ分到詞上：疲れた 的ルビ在詞裡面；一段ルビ跨兩個詞（不動産＋屋）時合成一個單位', () => {
    const units = (ja: string) => {
      const r = read(ja);
      return wordUnits(ja, rubyDisplay(ja, r.讀音, r.讀音分詞), r.羅馬拼音分詞)!.map(
        (u) => `${u.segments.map((s) => (s.rt ? `${s.text}(${s.rt})` : s.text)).join('')}=${u.羅馬拼音}`,
      );
    };
    expect(units('今日は疲れた')).toEqual(['今日(きょう)=kyō', 'は=wa', '疲(つか)れた=tsukareta']);
    expect(units('不動産屋さん')).toEqual(['不動産屋(ふどうさんや)=fudōsan ya', 'さん=san']);
  });
});
