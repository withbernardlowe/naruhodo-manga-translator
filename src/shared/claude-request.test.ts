import { describe, expect, it } from 'vitest';
import { addUsage, CLAUDE_MODEL, COMPATIBLE_PROMPT_VERSIONS, mergeRetranslated, notesRequest, retranslateRequest, suspectLines, PROMPT_VERSION, parseNotesResponse, parseSeriesGuessResponse, parseTranslateResponse, seriesGuessRequest, translateRequest } from './claude-request.ts';
import type { NotesInput, TitleSignals, TranslateInput } from './translator.ts';

const input: TranslateInput = {
  seriesNotes: [{ seriesId: 's1', 原文: '霧島湊', 讀音: 'きりしまみなと', 譯文: '霧島湊', 類別: '人名', locked: true }],
  priorPages: [[{ kind: 'balloon', 原文: '湊！', 譯文: '湊！' }]],
  items: [{ id: 'b1', kind: 'balloon', 原文: 'おはよう', orientation: 'vertical' }],
};

const notesInput: NotesInput = {
  seriesNotes: [],
  items: [{ kind: 'balloon', 原文: 'パン屋に行こう', 譯文: '去麵包店吧' }],
};

const usage = { input_tokens: 300, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 700 };

const apiResponse = (answer: unknown, stop_reason = 'end_turn') => ({
  model: CLAUDE_MODEL,
  stop_reason,
  content: [{ type: 'text', text: JSON.stringify(answer) }],
  usage,
});

describe('共用的 request 組裝模組（Own API Key 與 Worker 共用）', () => {
  it('翻譯的 request body 只由結構化輸入決定：model、max_tokens、system、Prior Pages 都由模組定', () => {
    const body = translateRequest(input);

    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.max_tokens).toBe(16_000);
    expect(body.system).toHaveLength(2);
    // Series Notes 只送內容，不送本機才有意義的 seriesId、locked
    expect(body.system[1]?.text).toContain('"原文":"霧島湊"');
    expect(body.system[1]?.text).not.toContain('seriesId');
    expect(body.system[1]?.text).not.toContain('locked');
    expect(body.messages[0]?.content.map((c) => c.text)).toEqual([
      'context（前面的頁，依閱讀順序）：\n[[{"kind":"balloon","ja":"湊！","zh":"湊！"}]]',
      '這一頁要翻譯的文字：\n[{"id":"b1","kind":"balloon","ja":"おはよう"}]',
    ]);
  });

  it('Series 有名稱時，作品名放在 user message 最前面，之後是 Prior Pages 與這一頁', () => {
    const body = translateRequest({ ...input, seriesName: '星屑バンド' });

    expect(body.messages[0]?.content.map((c) => c.text)).toEqual([
      '作品名：星屑バンド',
      'context（前面的頁，依閱讀順序）：\n[[{"kind":"balloon","ja":"湊！","zh":"湊！"}]]',
      '這一頁要翻譯的文字：\n[{"id":"b1","kind":"balloon","ja":"おはよう"}]',
    ]);
    // 作品名每部不同，不放進 system，指示那段的 prompt cache 照樣命中
    expect(body.system).toEqual(translateRequest(input).system);
  });

  it('沒有 Prior Pages 也有作品名時，這一頁的原文同樣標出來', () => {
    const body = translateRequest({ ...input, priorPages: [], seriesName: '星屑バンド' });

    expect(body.messages[0]?.content.map((c) => c.text)).toEqual([
      '作品名：星屑バンド',
      '這一頁要翻譯的文字：\n[{"id":"b1","kind":"balloon","ja":"おはよう"}]',
    ]);
  });

  it('有中文作品名時跟原名一起送，原文出現作品名就用中文作品名，不照抄假名', () => {
    const body = translateRequest({ ...input, priorPages: [], seriesName: 'ほしくずて穴', seriesZhTitle: '星屑之穴' });

    expect(body.messages[0]?.content.map((c) => c.text)).toEqual([
      '作品名：ほしくずて穴\n作品名的中文譯名：星屑之穴',
      '這一頁要翻譯的文字：\n[{"id":"b1","kind":"balloon","ja":"おはよう"}]',
    ]);
    expect(body.system).toEqual(translateRequest(input).system);
    // Series Notes 把作品名記成原名照抄時，以中文作品名為準（既有的 Notes 不用遷移）
    expect(body.system[0]?.text).toMatch(/作品名的中文譯名[^\n]*平假名[^\n]*片假名[^\n]*Series Notes[^\n]*為準/);
  });

  it('改了 ① 的 prompt：PROMPT_VERSION 是 v11，v10 的快取照用', () => {
    expect(PROMPT_VERSION).toBe('claude-text-v11');
    expect(COMPATIBLE_PROMPT_VERSIONS).toContain('claude-text-v10');
  });

  it('一句話拆在好幾項時，每項只翻自己那段，不把後一項併進前一項、不留空', () => {
    const [instructions] = translateRequest(input).system;

    expect(instructions?.text).toMatch(/拆在相鄰的好幾項[^\n]*只翻自己那一段[^\n]*不要把後面一項的意思併進前一項[^\n]*空字串[^\n]*只有 unreadable/);
  });

  it('沒有作品名時不送作品名', () => {
    const body = translateRequest(input);

    expect(JSON.stringify(body.messages)).not.toContain('作品名');
  });

  it('翻譯的指示含作品名、真實專有名詞與敬稱的翻法', () => {
    const [instructions] = translateRequest(input).system;

    // 作品名：不當狀聲詞，有官方譯名就用
    expect(instructions?.text).toMatch(/作品名[^\n]*狀聲詞/);
    // T2：真實世界的樂團、品牌、作品名用官方寫法或保留原文
    expect(instructions?.text).toMatch(/真實世界[^\n]*樂團[^\n]*品牌[^\n]*官方[^\n]*保留原文/);
    // T3：さん 依場景翻成「同學」、只叫名字或省略，不要一律翻成先生／小姐
    expect(instructions?.text).toMatch(/さん[^\n]*同學[^\n]*省略[^\n]*先生／小姐/);
  });

  it('翻譯的 schema 每一項都要回 sfx，指示寫明擬音、擬態算 Sound Effect，角色自己的感嘆不算', () => {
    const body = translateRequest(input);
    const item = (body.output_config.format.schema as { properties: { items: { items: { properties: Record<string, { type: string }>; required: string[] } } } }).properties.items.items;

    expect(item.properties.sfx?.type).toBe('boolean');
    expect(item.required).toContain('sfx');
    expect(body.system[0]?.text).toMatch(/sfx[^\n]*擬音[^\n]*擬態[^\n]*感嘆[^\n]*不算/);
  });

  it('unreadable 只指 OCR 亂碼與劇情上本來就看不懂的字，變體表記照常翻譯（#179）', () => {
    const text = translateRequest(input).system[0]?.text;

    expect(text).toMatch(/unreadable[^\n]*OCR 亂碼[^\n]*本來就[^\n]*看不懂/);
    expect(text).toMatch(/變體表記不是亂碼（只適用於 kind 是 balloon[^\n]*loose 照上面的規則[^\n]*假名[^\n]*照常翻譯[^\n]*改字[^\n]*不算/);
  });

  it('翻譯不回讀音（#195）：schema 沒有 reading，指示也不要求讀音', () => {
    const body = translateRequest(input);
    const item = (body.output_config.format.schema as { properties: { items: { items: { properties: Record<string, unknown>; required: string[] } } } }).properties.items.items;

    expect(Object.keys(item.properties)).not.toContain('reading');
    expect(body.system[0]?.text).not.toMatch(/reading|讀音/);
  });

  it('指示要求片假名的專有名詞翻成中文、完整的句子句尾有全形標點（#195）', () => {
    const text = translateRequest(input).system[0]?.text;

    expect(text).toMatch(/片假名寫的人名[^\n]*不要在譯文裡留下片假名/);
    expect(text).toMatch(/完整的句子[^\n]*句尾要有全形標點[^\n]*狀聲詞不用加/);
  });

  it('schema 先要整頁一份 names 再要 items：模型先寫出名字的中文譯名，zh 才不會照抄假名', () => {
    const schema = translateRequest(input).output_config.format.schema as {
      properties: Record<string, unknown> & { items: { items: { properties: Record<string, unknown> } } };
      required: string[];
    };

    // structured output 依 properties 的順序產生，names 一定要排在 items 前面
    expect(Object.keys(schema.properties)).toEqual(['names', 'items']);
    expect(schema.required).toContain('names');
    // 每一項都帶 names 時，模型會照著前一項的空陣列把 zh 也寫成空字串（長頁整頁空白）
    expect(Object.keys(schema.properties.items.items.properties)).toEqual(['id', 'zh', 'unreadable', 'sfx']);
  });

  it('names 的指示：假名要音譯成中文字，不照抄、不用羅馬拼音，zh 沿用 names 的譯名', () => {
    const text = translateRequest(input).system[0]?.text;

    expect(text).toMatch(/names：這一頁所有 ja[^\n]*平假名、片假名要音譯成中文字，不能照抄，也不能改寫成羅馬拼音/);
    expect(text).toMatch(/names：[^\n]*zh 裡要用 names 的譯名/);
    // names 會讓模型想在譯名後面加註原文，例如「巧克（チョコちゃん）」
    expect(text).toMatch(/names：[^\n]*不要在名字後面用括號附上原文或羅馬拼音/);
    // 名字翻了、敬稱照抄，例如「巧克ちゃん」
    expect(text).toMatch(/names：[^\n]*敬稱（ちゃん、さん、君等）[^\n]*翻成中文或省略，不要把假名留在譯文裡/);
  });

  it('保留原文只限真實世界的名稱，作品裡虛構的歌手、偶像照專有名詞的規則翻', () => {
    const text = translateRequest(input).system[0]?.text;

    expect(text).toMatch(/保留原文[^\n]*只限現實中真的存在[^\n]*虛構的歌手、偶像[^\n]*翻成中文/);
  });

  it('整理 Notes 的 request body：沒有 Series Notes 時 system 只有指示一段', () => {
    const body = notesRequest(notesInput);

    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.system).toHaveLength(1);
    expect(body.messages[0]?.content[0]?.text).toBe('[{"kind":"balloon","ja":"パン屋に行こう","zh":"去麵包店吧"}]');
  });

  it('解析翻譯回應：譯文、用量與模型', () => {
    const out = parseTranslateResponse(apiResponse({ items: [{ id: 'b1', zh: '早安', unreadable: false, sfx: false }] }));

    expect(out).toEqual({
      items: [{ id: 'b1', 譯文: '早安', unreadable: false, sfx: false }],
      usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 700, cacheWriteTokens: 0, costUsd: 0.000137 },
      model: CLAUDE_MODEL,
    });
  });

  it('解析翻譯回應：names 只給模型用，不往下傳', () => {
    const out = parseTranslateResponse(
      apiResponse({ names: [{ ja: 'ひなた', zh: '日向' }], items: [{ id: 'b1', zh: '早安，日向！', unreadable: false, sfx: false }] }),
    );

    expect(out.items).toEqual([{ id: 'b1', 譯文: '早安，日向！', unreadable: false, sfx: false }]);
  });

  it('解析 Notes 回應：轉成新增／補空欄位／建議修改', () => {
    const out = parseNotesResponse(
      apiResponse({
        notes_changes: {
          added: [{ ja: 'パン屋', reading: 'ぱんや', zh: '麵包店', category: '地名', note: '' }],
          filled: [],
          suggestions: [],
        },
      }),
    );

    expect(out.notes_changes).toEqual({
      added: [{ 原文: 'パン屋', 讀音: 'ぱんや', 譯文: '麵包店', 類別: '地名' }],
      filled: [],
      suggestions: [],
    });
  });

  it('回應被截斷或不符合 schema 時丟錯', () => {
    expect(() => parseTranslateResponse(apiResponse({ items: [] }, 'max_tokens'))).toThrow('stop_reason: max_tokens');
    expect(() => parseNotesResponse(apiResponse({ items: [] }))).toThrow('不符合 schema');
    expect(() => parseTranslateResponse(apiResponse({ items: [{ id: 'b1', zh: '', unreadable: false }] }))).toThrow('不符合 schema');
  });
});

describe('從頁面標題猜作品原名（#186）', () => {
  const signals: TitleSignals = { title: '[第12話]星降る町の郵便屋 - 作者名 | 漫畫網站', ogTitle: '', headings: ['第12話', '星降る町の郵便屋'] };

  it('request 只送頁面文字：標題、og:title、標題列，不送網址；回答固定是 JSON schema', () => {
    const body = seriesGuessRequest(signals);

    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.output_config.format.schema).toMatchObject({ required: ['status', 'original_title', 'zh_title'] });
    expect(JSON.parse(body.messages[0]!.content[0]!.text)).toEqual({
      title: '[第12話]星降る町の郵便屋 - 作者名 | 漫畫網站',
      og_title: '',
      headings: ['第12話', '星降る町の郵便屋'],
    });
  });

  it('指示寫明要去掉集數、話數、レーベル、作者、網站名、特典標記，保留副標題、外傳與續作名稱；首頁與列表回 unknown', () => {
    const instructions = seriesGuessRequest(signals).system.map((b) => b.text).join('\n');

    for (const word of ['集數', '話數', 'レーベル', '作者', '網站名', '特典', '副標題', '外傳', '續作', '首頁', '列表', '搜尋', '登入', '雜誌合集', 'unknown']) {
      expect(instructions).toContain(word);
    }
  });

  it('解析回應：原名、中文譯名與用量', () => {
    const parsed = parseSeriesGuessResponse(apiResponse({ status: 'work', original_title: '星降る町の郵便屋', zh_title: '星落小鎮的郵差' }));

    expect(parsed).toMatchObject({ status: 'work', 原名: '星降る町の郵便屋', 中文譯名: '星落小鎮的郵差', model: CLAUDE_MODEL });
    expect(parsed.usage.outputTokens).toBe(200);
  });

  it('status 不是 work／unknown 時丟錯', () => {
    expect(() => parseSeriesGuessResponse(apiResponse({ status: 'maybe', original_title: '', zh_title: '' }))).toThrow('schema');
  });
});

describe('譯文檢查與補翻（Discussion #296、#297、#309）', () => {
  const line = (id: string, 原文: string) => ({ id, kind: 'balloon' as const, 原文, orientation: 'vertical' as const });
  const got = (id: string, 譯文: string, unreadable = false) => ({ id, 譯文, unreadable, sfx: false });
  const page: TranslateInput = {
    seriesNotes: [],
    priorPages: [],
    items: [line('b1', 'おはよう'), line('b2', 'ミナトさんからだ'), line('b3', 'リアルに想像できない'), line('b4', 'あるんか？')],
  };

  it('譯文是空的卻沒標 unreadable、或這一項沒回：要再問；標了 unreadable 的空譯文不用', () => {
    const lines = [line('b1', 'あるんか？'), line('b2', '※●▲'), line('b3', 'みてえ…')];

    expect(suspectLines(lines, [got('b1', ''), got('b2', '', true)])).toEqual([
      { id: 'b1', reasons: ['empty'] },
      { id: 'b3', reasons: ['empty'] },
    ]);
  });

  it('譯文裡留著平假名或片假名：要再問；長音「ー」與中點「・」不算', () => {
    const lines = [line('b1', 'ミナトさんからだ'), line('b2', '別に…嫌じゃないし'), line('b3', 'ロン・バルドだー')];

    expect(suspectLines(lines, [got('b1', '是ミナト姐打來的。'), got('b2', '別に……嫌じゃないし。'), got('b3', '是羅恩・巴爾德ー')])).toEqual([
      { id: 'b1', reasons: ['kana'] },
      { id: 'b2', reasons: ['kana'] },
    ]);
  });

  it('譯文裡有原文沒有的英文字母（半形、全形）：要再問；原文本來就有英文的不用', () => {
    const lines = [line('b1', 'リアルに想像できない'), line('b2', 'Tシャツ買った'), line('b3', 'オーケー'), line('b4', 'ＯＫ！')];

    expect(suspectLines(lines, [got('b1', '我 real 的想像不出來'), got('b2', '買了 T 恤'), got('b3', 'ＯＫ'), got('b4', 'OK！')])).toEqual([
      { id: 'b1', reasons: ['latin'] },
      { id: 'b3', reasons: ['latin'] },
    ]);
  });

  it('同一句同時留著假名又多出英文：兩個原因都列；沒問題的頁是空陣列', () => {
    expect(suspectLines([line('b1', 'マジでリアル')], [got('b1', 'マジ real')])).toEqual([{ id: 'b1', reasons: ['kana', 'latin'] }]);
    expect(suspectLines(page.items, [got('b1', '早安'), got('b2', '是湊姐打來的。'), got('b3', '完全想像不出來。'), got('b4', '有嗎？')])).toEqual([]);
  });

  it('補翻的 request：system 與前面的 user 內容跟 ① 逐字相同（prompt cache 命中），最後多一段只列有問題的那幾項', () => {
    const first = [got('b1', '早安'), got('b2', '是ミナト姐打來的。'), got('b3', '我 real 的想像不出來'), got('b4', '')];
    const suspects = suspectLines(page.items, first);
    const original = translateRequest(page);

    const body = retranslateRequest(page, first, suspects);

    expect({ ...body, messages: undefined }).toEqual({ ...original, messages: undefined });
    const content = body.messages[0]!.content;
    expect(content.slice(0, -1)).toEqual(original.messages[0]!.content);
    const [instruction, list] = content.at(-1)!.text.split('\n');
    expect(instruction).toMatch(/只重新翻譯這幾項.*其他項不要回傳/);
    expect(JSON.parse(list!)).toEqual([
      { id: 'b2', ja: 'ミナトさんからだ', zh: '是ミナト姐打來的。', problem: expect.stringMatching(/假名/) },
      { id: 'b3', ja: 'リアルに想像できない', zh: '我 real 的想像不出來', problem: expect.stringMatching(/英文字母/) },
      { id: 'b4', ja: 'あるんか？', zh: '', problem: expect.stringMatching(/空字串/) },
    ]);
  });

  it('併回補翻的答案：只換有問題的那幾項，補翻多回的其他項不看；第一次沒回的項補在最後', () => {
    const first = [got('b1', '早安'), got('b2', '是ミナト姐打來的。'), got('b4', '')];
    const suspects = suspectLines(page.items, first);

    const merged = mergeRetranslated(first, [got('b1', '早上好'), got('b2', '是湊姐打來的。'), got('b3', '完全想像不出來。'), got('b4', '有嗎？')], suspects);

    expect(merged).toEqual({
      items: [got('b1', '早安'), got('b2', '是湊姐打來的。'), got('b4', '有嗎？'), got('b3', '完全想像不出來。')],
      replaced: 3,
    });
  });

  it('補翻的答案照收（還留著假名、改標 unreadable 都收）；只有第一次有譯文、補翻卻回空字串時留著第一次的', () => {
    const lines = [line('b1', 'ポルカ亭見た？'), line('b2', '下三乃吉へ'), line('b3', 'ミナトだ')];
    const first = [got('b1', '你看了《ポルカ亭》嗎？'), got('b2', '下三乃吉へ'), got('b3', '是ミナト。')];

    const merged = mergeRetranslated(first, [got('b1', '你看《ポルカ亭》了嗎？'), got('b2', '', true), got('b3', '')], suspectLines(lines, first));

    expect(merged).toEqual({ items: [got('b1', '你看《ポルカ亭》了嗎？'), got('b2', '', true), got('b3', '是ミナト。')], replaced: 2 });
  });

  it('兩次呼叫的用量相加；舊資料沒有 cacheWriteTokens 當成 0', () => {
    expect(
      addUsage(
        { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 700, costUsd: 0.000137 },
        { inputTokens: 1100, outputTokens: 30, cacheReadTokens: 900, cacheWriteTokens: 50, costUsd: 0.000044 },
      ),
    ).toEqual({ inputTokens: 2100, outputTokens: 230, cacheReadTokens: 1600, cacheWriteTokens: 50, costUsd: 0.000181 });
  });
});
