/**
 * 這台機器一次只跑一輪 Playwright 測試（browser test、e2e、smoke、錄 OCR）：第二輪在 globalSetup 等前一輪跑完。
 * 好幾個 worktree 同時跑時，兩輪的瀏覽器互搶 CPU，不相干的測試會逾時；本機 Worker 的 port 也只有一個。
 * 鎖是暫存目錄裡的一個檔案，內容是持有者的 pid 與工作目錄；持有者已經不在（被強制關掉）就直接接手。
 */
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEST_LOCK_PATH = join(tmpdir(), 'naruhodo-playwright.lock');

/** 建檔與寫入不是同一步：讀到空檔時，這麼久以內當成持有者還在寫。 */
const WRITE_GRACE_MS = 10_000;

interface Holder {
  pid: number;
  cwd: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM：行程在，只是不能送訊號給它
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 鎖檔的持有者；'stale'＝持有者不在了，可以接手；undefined＝鎖剛被放掉或還在寫。 */
function readHolder(path: string): Holder | 'stale' | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const holder = JSON.parse(text) as Holder;
    return isAlive(holder.pid) ? holder : 'stale';
  } catch {
    try {
      return Date.now() - statSync(path).mtimeMs > WRITE_GRACE_MS ? 'stale' : undefined;
    } catch {
      return undefined;
    }
  }
}

/** 拿到鎖才回傳；回傳放掉鎖的函式。行程結束時也會放掉。 */
export async function acquireTestLock({
  path = TEST_LOCK_PATH,
  pollMs = 1000,
  timeoutMs = 30 * 60_000,
  log = console.log,
}: {
  path?: string;
  pollMs?: number;
  timeoutMs?: number;
  log?: (message: string) => void;
} = {}): Promise<() => void> {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  for (;;) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, cwd: process.cwd() } satisfies Holder), { flag: 'wx' });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const holder = readHolder(path);
    if (holder === 'stale') {
      rmSync(path, { force: true, maxRetries: 5, retryDelay: 100 });
      continue;
    }
    const who = holder ? `${holder.cwd}，pid ${holder.pid}` : path;
    if (Date.now() > deadline) throw new Error(`等了 ${Math.round(timeoutMs / 60_000)} 分鐘，另一輪 Playwright 測試還沒跑完（${who}）`);
    if (!announced) log(`另一輪 Playwright 測試正在跑（${who}），等它跑完再開始…`);
    announced = true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  const release = () => {
    process.off('exit', release);
    const holder = readHolder(path);
    if (holder && holder !== 'stale' && holder.pid === process.pid) rmSync(path, { force: true, maxRetries: 5, retryDelay: 100 });
  };
  process.once('exit', release);
  return release;
}
