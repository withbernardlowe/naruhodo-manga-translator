/**
 * 在本機啟動 Hosted Translation 的 Worker（worker/）給 browser test 與 smoke 用：`wrangler dev`、本機 D1
 * （每次一個全新的暫存目錄，跑完就刪），port 是 `npm run build:e2e` 挑好、寫進 e2e build 的那個（E2E_WORKER_PORT_FILE）。
 * env：test＝Anthropic 換成 FakeTranslator（browser test）；dev＝真的 Anthropic 與 Paddle sandbox（smoke）。
 * dev 的 secret 放在 wrangler 子行程的 env（secrets；wrangler.jsonc 的 env.dev 宣告了 secrets.required），或 envFile。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_WORKER_PORT_FILE } from '../scripts/build.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const WRANGLER = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const CONFIG = join(root, 'worker', 'wrangler.jsonc');
const MIGRATIONS = join(root, 'worker', 'migrations');
/** wrangler dev 冷啟動通常 3–5 秒（建 bundle、起 workerd）。 */
const READY_TIMEOUT_MS = 30_000;

function readWorkerPort(): number {
  if (!existsSync(E2E_WORKER_PORT_FILE)) throw new Error(`沒有 ${E2E_WORKER_PORT_FILE}：先跑 npm run build:e2e`);
  return Number(readFileSync(E2E_WORKER_PORT_FILE, 'utf8'));
}

export const WORKER_PORT = readWorkerPort();
export const WORKER_URL = `http://localhost:${WORKER_PORT}`;

async function isUp(): Promise<boolean> {
  try {
    await fetch(WORKER_URL);
    return true;
  } catch {
    return false;
  }
}

/** 啟動 Worker、等它回應；回傳關掉它（並刪掉本機 D1）的函式。 */
export async function startWorker({
  env,
  envFile,
  secrets = {},
}: {
  env: 'test' | 'dev';
  envFile?: string;
  /** 只放在 wrangler 子行程的 env，不寫進檔案（#175）。 */
  secrets?: Record<string, string>;
}): Promise<() => Promise<void>> {
  // build 挑完 port 到這裡之間被別人拿走了：重跑 npm run test:browser，build 會換一個空的
  if (await isUp()) throw new Error(`${WORKER_URL} 已經有東西在跑；重跑 npm run test:browser 會重新 build、換一個空的 port`);
  const persistTo = await mkdtemp(join(tmpdir(), 'naruhodo-d1-'));
  const common = ['-c', CONFIG, '--env', env, '--persist-to', persistTo];
  // 第一個 migration（#91）加進來之前沒有這個目錄，wrangler 會報錯
  if (existsSync(MIGRATIONS)) {
    const applied = spawnSync(process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', 'DB', '--local', ...common], { encoding: 'utf8' });
    if (applied.status !== 0) throw new Error(`D1 migrations 失敗：\n${applied.stdout}\n${applied.stderr}`);
  }
  // 一律給 --env-file：沒給的話 wrangler 會讀開發者殘留的 worker/.dev.vars（#175 起不再用它），裡面的值會蓋掉這裡要給的
  const vars = envFile ?? join(persistTo, '.dev.vars');
  if (!envFile) await writeFile(vars, '');
  const args = [WRANGLER, 'dev', ...common, '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--show-interactive-dev-session=false'];
  const child = spawn(process.execPath, [...args, '--env-file', vars], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...secrets } });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk));

  const stop = async () => {
    // wrangler 底下還有 workerd；Windows 要連子行程一起關
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill();
    await rm(persistTo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!(await isUp())) {
    if (child.exitCode !== null || Date.now() > deadline) {
      await stop();
      throw new Error(`wrangler dev 沒有啟動：\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return stop;
}
