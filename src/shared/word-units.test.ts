import { describe, expect, it } from 'vitest';
import type { RomajiWord } from './page-text.ts';
import type { RubyDisplay } from './ruby.ts';
import { wordUnits } from './word-units.ts';

/** 「今日(きょう)|は=wa」：一個單位的ルビ寫成 漢字(讀音)，等號後面是羅馬拼音。 */
function describeUnits(ja: string, display: RubyDisplay | undefined, words: RomajiWord[] | undefined): string[] | null {
  const units = wordUnits(ja, display, words);
  return units && units.map((u) => `${u.segments.map((s) => (s.rt ? `${s.text}(${s.rt})` : s.text)).join('')}=${u.羅馬拼音}`);
}

const w = (spec: string): RomajiWord[] =>
  spec.split(' ').map((pair) => {
    const [原文, 羅馬拼音] = pair.split('=');
    return { 原文: 原文!, 羅馬拼音: 羅馬拼音! };
  });

describe('wordUnits：ルビ按羅馬拼音的詞分配', () => {
  it('ルビ段跟著所在的詞；沒有ルビ的段在詞的邊界切開', () => {
    const display: RubyDisplay = { segments: [{ text: '今日', rt: 'きょう' }, { text: 'は' }, { text: '疲', rt: 'つか' }, { text: 'れた' }] };
    expect(describeUnits('今日は疲れた', display, w('今日=kyō は=wa 疲れた=tsukareta'))).toEqual(['今日(きょう)=kyō', 'は=wa', '疲(つか)れた=tsukareta']);
  });

  it('沒有ルビ的長段跨好幾個詞也切得開（促音跨詞的 待って 是一個詞）', () => {
    const display: RubyDisplay = { segments: [{ text: 'ちょっと' }, { text: '待', rt: 'ま' }, { text: 'ってください！' }] };
    expect(describeUnits('ちょっと待ってください！', display, w('ちょっと=chotto 待って=matte ください！=kudasai!'))).toEqual([
      'ちょっと=chotto',
      '待(ま)って=matte',
      'ください！=kudasai!',
    ]);
  });

  it('一段ルビ跨兩個詞（漢字接尾詞 不動産＋屋）：兩個詞合成一個單位，羅馬拼音用空格接起來', () => {
    const display: RubyDisplay = { segments: [{ text: '不動産屋', rt: 'ふどうさんや' }, { text: 'さん' }] };
    expect(describeUnits('不動産屋さん', display, w('不動産=fudōsan 屋=ya さん=san'))).toEqual(['不動産屋(ふどうさんや)=fudōsan ya', 'さん=san']);
  });

  it('讀音對不上（fallback）或不顯示ルビ：照樣按詞切，只是沒有ルビ', () => {
    const words = w('6=6 年=nen');
    expect(describeUnits('6年', { fallback: 'ろくねん' }, words)).toEqual(['6=6', '年=nen']);
    expect(describeUnits('6年', undefined, words)).toEqual(['6=6', '年=nen']);
  });

  it('沒有詞資料（舊快取補算不了），或詞接起來不是原文：null，退回整句一行', () => {
    expect(wordUnits('今日は', undefined, undefined)).toBeNull();
    expect(wordUnits('今日は', undefined, w('今日=kyō'))).toBeNull();
  });
});
