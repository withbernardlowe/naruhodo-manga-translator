/**
 * 在開著的 debug Chrome 裡自動翻頁，找到 Problem Report 回報的那一頁（docs/agents/real-site-debugging.md）。
 *   npm run debug:find -- <pageHash> [<pageHash>...]
 * 報告只有數字、沒有頁碼，讀者也常說不出是第幾頁；所以一次翻一頁，拿外掛每次裁出的 Page hash（trace 的 crop）
 * 跟報告的 pageHash 比，Hamming 距離在「同一個 Page」的門檻內就停在那一頁。
 *
 * 先決條件：debug:chrome 正在錄製、漫畫分頁已經 debug:activate、視窗沒有被別的視窗完全蓋住（蓋住時分頁算隱藏，截不到圖）。
 * 外掛是啟動的，所以沿路每一頁沒在快取裡的都會翻譯、算進額度。
 *
 * 選項：--key <鍵>（預設 ArrowRight；右到左的閱讀器 ArrowRight 是上一頁、ArrowLeft 是下一頁）、--max <次數>（預設 100）、
 *       --url <字串>（挑 url 含它的分頁）、--port <n>
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectCdp, DEBUG_DIR, isListening } from './debug-chrome.ts';
import { latestCrop, latestSession, matchPages, type SessionRecord } from './debug-session.ts';
import { candidateTargets, type TargetInfo } from './debug-targets.ts';

const DEFAULT_PORT = 9222;
const DEFAULT_MAX_TURNS = 100;
/** 按鍵後最多等這麼久出現新的 crop；真實 Chrome 截圖加裁切約 1 秒。 */
const CROP_WAIT_MS = 8000;
/** 新的 crop 出現後再等這麼久：翻頁動畫中途截到的那次之後，停下來還會再截一次。 */
const SETTLE_MS = 700;
/** 連續這麼多次按鍵後畫面上的頁都沒變，就當成翻到頭了（或按鍵沒送到閱讀器）。 */
const MAX_UNCHANGED = 3;
const KEY_CODES: Record<string, number> = { ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, PageUp: 33, PageDown: 34, ' ': 32 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2).filter((arg) => /^[0-9a-f]{64}$/.test(arg));
  if (wanted.length === 0) throw new Error('用法：npm run debug:find -- <pageHash> [<pageHash>...] [--key ArrowLeft] [--max 100] [--url <字串>]');
  const port = Number(option('--port') ?? DEFAULT_PORT);
  const key = option('--key') ?? 'ArrowRight';
  const keyCode = KEY_CODES[key];
  if (keyCode === undefined) throw new Error(`不認得的鍵「${key}」；可以用：${Object.keys(KEY_CODES).join('、')}`);
  const maxTurns = Number(option('--max') ?? DEFAULT_MAX_TURNS);
  if (!(await isListening(port))) throw new Error(`port ${port} 沒有開著的 Chrome；先跑 npm run debug:chrome`);

  const session = latestSession(await readdir(DEBUG_DIR));
  if (session === undefined) throw new Error(`${DEBUG_DIR} 裡還沒有錄製記錄`);
  const tracePath = join(DEBUG_DIR, session, 'trace.jsonl');
  const crop = async () => {
    const text = await readFile(tracePath, 'utf8');
    return latestCrop(text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as SessionRecord));
  };

  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as TargetInfo[];
  const tab = candidateTargets(targets, 'page', option('--url'))[0];
  if (!tab) throw new Error('找不到漫畫分頁（用 --url 指定）');
  console.error(`分頁 → ${tab.url}`);

  const cdp = await connectCdp(port);
  try {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: tab.id, flatten: true });
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }, sessionId);
    if (result.value !== 'visible') throw new Error('漫畫分頁現在是隱藏的（視窗被完全蓋住、最小化，或不是作用中的分頁）：截不到圖。請使用者把 debug Chrome 的視窗擺到看得見的地方');

    const report = (turn: number, at: { line: number; hashes: string[] }) => {
      const matches = matchPages(at.hashes, wanted);
      console.log(`${String(turn).padStart(3)}  trace 第 ${at.line} 行  ${at.hashes.map((h) => h.slice(0, 8)).join(' ')}  距離 ${matches.map((m) => m.distance).join(' ')}`);
      return matches.some((m) => m.found);
    };

    const first = await crop();
    if (!first) throw new Error('trace 裡還沒有 crop：先在漫畫分頁跑 npm run debug:activate');
    let last = first;
    if (report(0, last)) return console.log('已經在這一頁');

    let unchanged = 0;
    for (let turn = 1; turn <= maxTurns; turn++) {
      for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: keyCode }, sessionId);
      let next = last;
      for (let waited = 0; waited < CROP_WAIT_MS && next.line === last.line; waited += 250) {
        await sleep(250);
        next = (await crop()) ?? last;
      }
      if (next.line !== last.line) {
        await sleep(SETTLE_MS);
        next = (await crop()) ?? next;
      }
      unchanged = next.hashes.join() === last.hashes.join() ? unchanged + 1 : 0;
      last = next;
      if (report(turn, last)) return console.log(`找到了：翻了 ${turn} 次，停在這一頁（trace 第 ${last.line} 行）`);
      if (unchanged >= MAX_UNCHANGED) throw new Error(`連續 ${MAX_UNCHANGED} 次按「${key}」頁面都沒變：翻到頭了（換另一個方向的鍵），或按鍵沒送到閱讀器`);
    }
    throw new Error(`翻了 ${maxTurns} 次還沒找到；換方向（--key）或加大 --max`);
  } finally {
    cdp.close();
  }
}

try {
  await main();
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
