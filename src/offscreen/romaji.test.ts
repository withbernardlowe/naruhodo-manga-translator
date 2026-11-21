import { describe, expect, it } from 'vitest';
import { romaji, romajiWords, type RomajiToken } from './romaji.ts';

/** 測試資料照 kuromoji（IPADIC）實際分析的結果抄：表層／詞性／細分類／讀音／發音。 */
const t = (spec: string): RomajiToken[] =>
  spec.split(' | ').map((part) => {
    const [surface, pos, posDetail1, reading, pronunciation] = part.split('/');
    return { surface: surface!, pos: pos!, posDetail1: posDetail1!, reading: reading || undefined, pronunciation: pronunciation || undefined };
  });

describe('romaji', () => {
  it('助詞照發音寫、獨立成一個詞，活用黏在動詞上，長音加長音符號', () => {
    expect(romaji(t('昨日/名詞/副詞可能/キノウ/キノー | は/助詞/係助詞/ハ/ワ | ラーメン/名詞/一般/ラーメン/ラーメン | を/助詞/格助詞/ヲ/ヲ | 食べ/動詞/自立/タベ/タベ | まし/助動詞/*/マシ/マシ | た/助動詞/*/タ/タ'))).toBe(
      'kinō wa rāmen o tabemashita',
    );
  });

  it('標點黏在前一個詞後面；へ 寫成 e；おう 寫成 ō；全部小寫', () => {
    expect(romaji(t('先生/名詞/一般/センセイ/センセイ | 、/記号/読点/、/、 | 東京/名詞/固有名詞/トウキョウ/トーキョー | へ/助詞/格助詞/ヘ/エ | 行く/動詞/自立/イク/イク | の/助詞/終助詞/ノ/ノ | ？/記号/一般/？/？'))).toBe(
      'sensei, tōkyō e iku no?',
    );
  });

  it('えい、いい 照寫不加長音符號（發音是 ー 也一樣）', () => {
    expect(romaji(t('大きい/形容詞/自立/オオキイ/オーキイ | 家/名詞/一般/イエ/イエ'))).toBe('ōkii ie');
    expect(romaji(t('先生/名詞/一般/センセイ/センセー'))).toBe('sensei');
  });

  it('動詞語尾的 う 不是長音（思う＝omou）', () => {
    expect(romaji(t('思う/動詞/自立/オモウ/オモウ | よ/助詞/終助詞/ヨ/ヨ'))).toBe('omou yo');
  });

  it('跨詞的 o＋う（行こ＋う）也是長音', () => {
    expect(romaji(t('学校/名詞/一般/ガッコウ/ガッコー | へ/助詞/格助詞/ヘ/エ | 行こ/動詞/自立/イコ/イコ | う/助動詞/*/ウ/ウ'))).toBe('gakkō e ikō');
  });

  it('て／で 黏在動詞上，ください 另起一個詞；ン 後面接母音加撇號', () => {
    expect(romaji(t('食べ/動詞/自立/タベ/タベ | て/助詞/接続助詞/テ/テ | 、/記号/読点/、/、 | 読ん/動詞/自立/ヨン/ヨン | で/助詞/接続助詞/デ/デ | ください/動詞/非自立/クダサイ/クダサイ'))).toBe(
      'tabete, yonde kudasai',
    );
    expect(romaji(t('原因/名詞/一般/ゲンイン/ゲンイン | は/助詞/係助詞/ハ/ワ'))).toBe("gen'in wa");
  });

  it('促音：重複下一個子音（ch 前面加 t），句尾的小っ不寫', () => {
    expect(romaji(t('ちょっと/副詞/助詞類接続/チョット/チョット | 待っ/動詞/自立/マッ/マッ | て/助詞/接続助詞/テ/テ | っ/動詞/非自立/ッ/ッ | …/記号/一般/…/…'))).toBe('chotto matte…');
    expect(romaji(t('ぼっちゃん/名詞/一般/ボッチャン/ボッチャン'))).toBe('botchan');
  });

  it('被動、使役語尾（動詞・接尾）黏在動詞上', () => {
    expect(romaji(t('書か/動詞/自立/カカ/カカ | れる/動詞/接尾/レル/レル'))).toBe('kakareru');
    expect(romaji(t('食べ/動詞/自立/タベ/タベ | られ/動詞/接尾/ラレ/ラレ | ない/助動詞/*/ナイ/ナイ'))).toBe('taberarenai');
  });

  it('口語的 ちゃう／ちゃ／てる 黏在前面，詞尾的促音接到下一個詞', () => {
    expect(romaji(t('知っ/動詞/自立/シッ/シッ | ちゃっ/動詞/非自立/チャッ/チャッ | た/助動詞/*/タ/タ'))).toBe('shitchatta');
    expect(romaji(t('行っ/動詞/自立/イッ/イッ | ちゃ/助詞/接続助詞/チャ/チャ | だめ/名詞/形容動詞語幹/ダメ/ダメ'))).toBe('itcha dame');
    expect(romaji(t('待っ/動詞/自立/マッ/マッ | てる/動詞/非自立/テル/テル'))).toBe('matteru');
  });

  it('寒暄語裡的「は」也照發音寫', () => {
    expect(romaji(t('こんにちは/感動詞/*/コンニチハ/コンニチワ'))).toBe('konnichiwa');
  });

  it('同母音後面的小假名是拉長的音', () => {
    expect(romaji(t('ハァハァ/名詞/固有名詞//'))).toBe('hāhā');
  });

  it('字典沒有的詞（狀聲詞）照表層的假名轉', () => {
    expect(romaji(t('ぱち/名詞/一般//'))).toBe('pachi');
  });

  it('外來語的小假名合成一個音；發音跟讀音不一樣長時只看讀音', () => {
    expect(romaji(t('ヴァイオリン/名詞/一般/ヴァイオリン/バイオリン |  /記号/空白// | ティー/名詞/一般/ティー/ティー'))).toBe('vaiorin tī');
  });
});

describe('romajiWords：每個詞的原文與羅馬拼音（hover 兩邊一起亮）', () => {
  const pairs = (spec: string) => romajiWords(t(spec)).map((w) => `${w.原文}=${w.羅馬拼音}`);

  it('助動詞、て 黏在前一個詞，原文也一起；助詞照發音', () => {
    expect(pairs('今日/名詞/副詞可能/キョウ/キョー | は/助詞/係助詞/ハ/ワ | 疲れ/動詞/自立/ツカレ/ツカレ | た/助動詞/*/タ/タ')).toEqual(['今日=kyō', 'は=wa', '疲れた=tsukareta']);
  });

  it('促音跨詞：待っ＋て 是一個詞 matte；標點黏在前一個詞', () => {
    expect(pairs('待っ/動詞/自立/マッ/マッ | て/助詞/接続助詞/テ/テ | ください/動詞/非自立/クダサイ/クダサイ | ！/記号/一般/！/！')).toEqual(['待って=matte', 'ください！=kudasai!']);
  });

  it('長音跨詞：行こ＋う 是一個詞 ikō', () => {
    expect(pairs('行こ/動詞/自立/イコ/イコ | う/助動詞/*/ウ/ウ')).toEqual(['行こう=ikō']);
  });

  it('句首的標點自己一個詞；拉長音「ー」併進前一個詞', () => {
    expect(pairs('…/記号/一般/…/… | かわい/形容詞/自立/カワイ/カワイ | ー/名詞/一般//')).toEqual(['…=…', 'かわいー=kawaī']);
  });

  it('不寫的記號也要留在原文裡：開括號接下一個詞、其他接前一個詞；空白是沒有羅馬拼音的詞', () => {
    const words = romajiWords(t('「/記号/括弧開/「/「 | 本/名詞/一般/ホン/ホン | 」/記号/括弧閉/」/」 |  /記号/空白// | 本/名詞/一般/ホン/ホン'));
    expect(words).toEqual([
      { 原文: '「本」', 羅馬拼音: 'hon' },
      { 原文: ' ', 羅馬拼音: '' },
      { 原文: '本', 羅馬拼音: 'hon' },
    ]);
  });

  it('詞接起來等於 romaji()', () => {
    const tokens = t('ちょっと/副詞/助詞類接続/チョット/チョット | 待っ/動詞/自立/マッ/マッ | て/助詞/接続助詞/テ/テ | っ/動詞/非自立/ッ/ッ | …/記号/一般/…/…');
    expect(romajiWords(tokens).map((w) => w.羅馬拼音).join(' ')).toBe(romaji(tokens));
    expect(romajiWords(tokens).map((w) => w.原文).join('')).toBe('ちょっと待ってっ…');
  });
});
