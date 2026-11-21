/**
 * 用法：node scripts/build.ts [--e2e | --debug]
 *   正式 build → dist/prod；e2e build → dist/e2e（多 <all_urls> 與測試入口，spec #27 第 12 節）；
 *   debug build → dist/debug（多印除錯記錄，src/shared/trace.ts；平常由 scripts/debug-chrome.ts 建到固定位置）
 *
 * 每個入口各自用 esbuild 打包，因為格式不同：
 *   - background（SW）、sidepanel、onboarding、settings、account（轉址）、offscreen：ES module
 *   - content：IIFE。scripting.executeScript({files}) 只能注入傳統 script，不能有 import。
 */
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { buildManifest } from '../src/manifest.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * 原樣複製進外掛的檔案：[來源（相對 repo 根目錄）, 輸出路徑]。
 * ONNX 模型不在這裡：第一次使用時才下載（spec #27 第 3.3 節）。
 * 字型檔不打包：side panel 與覆蓋層都用系統字型（src/shared/tokens.css）；譯文只有幾個標點用 Noto Sans TC，
 * 以 base64 打包在 content script 與 side panel 的 JS 裡（src/shared/punctuation-font.ts）。
 */
const STATIC_FILES: [string, string][] = [
  ['src/sidepanel/sidepanel.html', 'sidepanel.html'],
  // design tokens（#71）：side panel 直接載入；content script 另外把它打包成字串放進 shadow DOM
  ['src/shared/tokens.css', 'tokens.css'],
  // side panel 的畫面樣式（src/ui/，#108）；sidepanel.css 只剩外掛整頁的 html／body
  ['src/ui/components.css', 'components.css'],
  ['src/ui/side-panel.css', 'side-panel.css'],
  // 設定的內容（#326）：側邊欄 ⚙ 與設定頁共用
  ['src/ui/settings.css', 'settings-content.css'],
  ['src/sidepanel/sidepanel.css', 'sidepanel.css'],
  // 全新安裝時打開的全頁 onboarding（#93）：跟 side panel 共用 tokens.css、components.css
  ['src/onboarding/onboarding.html', 'onboarding.html'],
  ['src/onboarding/onboarding.css', 'onboarding.css'],
  // 設定頁（#326，options_ui）：帳號與訂閱（#213）是它的子畫面 #account
  ['src/settings/settings.html', 'settings.html'],
  ['src/settings/settings.css', 'settings.css'],
  ['src/settings/account.css', 'account.css'],
  // 舊的帳號與訂閱頁：只轉址到 settings.html#account，已經開著或被記下來的分頁不會壞
  ['src/account/account.html', 'account.html'],
  ['src/offscreen/offscreen.html', 'offscreen.html'],
  // onnxruntime-web 不打包進 offscreen.js，執行時動態 import（見 src/offscreen/ort-engine.ts）。
  // webgpu bundle 同時支援 WebGPU 與 wasm，只會載入 asyncify 這一份 wasm（與它的 .mjs，多執行緒 worker 用）。
  ['node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs', 'ort/ort.webgpu.bundle.min.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', 'ort/ort-wasm-simd-threaded.asyncify.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', 'ort/ort-wasm-simd-threaded.asyncify.wasm'],
];

/** 原樣複製的目錄。icons：外掛 icon 的 PNG 與 side panel 標題用的 SVG 母檔（PNG 由 scripts/icons.ts 產出）。 */
const STATIC_DIRS: [string, string][] = [
  ['node_modules/kuromoji/dict', 'kuromoji/dict'],
  ['src/icons', 'icons'],
];

/** e2e build 才有：量 #7 指標用的流水線測試頁（browser/ocr-accuracy.spec.ts）、覆蓋渲染測試頁（browser/overlay-render.spec.ts）。 */
const E2E_STATIC_FILES: [string, string][] = [
  ['src/test-pipeline/test-pipeline.html', 'test-pipeline.html'],
  ['src/test-overlay/test-overlay.html', 'test-overlay.html'],
];

/** e2e build 才有：FakeEngine 認頁用的合成圖（src/offscreen/fake-engine.ts）。 */
const E2E_STATIC_DIRS: [string, string][] = [['testdata/synthetic/out', 'synthetic']];

/**
 * browser test 與 smoke 啟動 wrangler dev（browser/worker.ts）的 port，e2e build 寫死連它。
 * `npm run build:e2e` 在 E2E_WORKER_PORTS 裡挑一個沒人用的（pickE2eWorkerPort），記在 E2E_WORKER_PORT_FILE，
 * 讓不同 worktree 同時跑 browser test 時各用各的 Worker。
 */
export const E2E_WORKER_PORTS = { first: 8788, count: 100 };
export const E2E_WORKER_PORT_FILE = join(root, 'dist', 'e2e-worker-port');

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/**
 * 從這個 worktree 自己的起點往後找第一個空的 port：起點由 repo 路徑決定，兩個 worktree 同時 build
 * （Worker 都還沒起來、port 都還空著）時通常也不會挑到同一個。
 */
export async function pickE2eWorkerPort(repoRoot = root, isFree = isPortFree): Promise<number> {
  const { first, count } = E2E_WORKER_PORTS;
  const start = createHash('sha1').update(repoRoot).digest().readUInt16BE(0) % count;
  for (let i = 0; i < count; i++) {
    const port = first + ((start + i) % count);
    if (await isFree(port)) return port;
  }
  throw new Error(`port ${first}–${first + count - 1} 都有人在用，起不了 browser test 的本機 Worker`);
}

/**
 * Hosted Translation 的 Worker 網址（worker/）：e2e build 連測試啟動的 wrangler dev（port 見 E2E_WORKER_PORTS）；debug build 連開發者自己跑的
 * `npm run worker:dev`（wrangler dev --env dev，預設 port 8787）；正式 build 連 production 的 Worker（worker/wrangler.jsonc 的 routes）。
 */
export function hostedApiUrl({ e2e, debug, workerPort }: { e2e: boolean; debug: boolean; workerPort: number }): string {
  return e2e ? `http://localhost:${workerPort}` : debug ? 'http://localhost:8787' : 'https://api.naruhodo.page';
}

export async function build({
  e2e,
  debug = false,
  outDir,
  workerPort = E2E_WORKER_PORTS.first,
}: {
  e2e: boolean;
  debug?: boolean;
  outDir: string;
  /** 只有 e2e build 用到 */
  workerPort?: number;
}): Promise<void> {
  // 只清空內容、不刪資料夾本身：debug Chrome 載入的就是這個資料夾，整個刪掉再建，
  // 重新載入時 Chrome 曾回報「File path cannot be resolved」並卡在停用（#27 除錯）
  await mkdir(outDir, { recursive: true });
  for (const name of await readdir(outDir)) await rm(join(outDir, name), { recursive: true, force: true });

  const common: esbuild.BuildOptions = {
    absWorkingDir: root,
    bundle: true,
    outdir: outDir,
    target: 'chrome116',
    define: {
      __E2E__: String(e2e),
      __DEBUG__: String(debug),
      __HOSTED_API_URL__: JSON.stringify(hostedApiUrl({ e2e, debug, workerPort })),
    },
    jsx: 'automatic',
    jsxImportSource: 'preact',
    sourcemap: e2e || debug ? 'inline' : false,
    // kuromoji 用 Node 的 path.join 拼字典網址
    alias: { path: './src/offscreen/path-shim.ts' },
    loader: { '.css': 'text' },
    logLevel: 'warning',
  };

  const files = [...STATIC_FILES, ...(e2e ? E2E_STATIC_FILES : [])];
  await Promise.all([
    esbuild.build({
      ...common,
      format: 'esm',
      entryPoints: {
        background: 'src/background/index.ts',
        sidepanel: 'src/sidepanel/main.tsx',
        onboarding: 'src/onboarding/main.tsx',
        settings: 'src/settings/main.tsx',
        account: 'src/account/main.tsx',
        offscreen: 'src/offscreen/index.ts',
        ...(e2e ? { 'test-pipeline': 'src/test-pipeline/main.ts', 'test-overlay': 'src/test-overlay/main.ts' } : {}),
      },
    }),
    esbuild.build({
      ...common,
      format: 'iife',
      // test-ui：注入一般網頁、證明網站能重用畫面的測試 script（browser/ui-reuse.spec.ts）
      entryPoints: { content: 'src/content/index.ts', ...(e2e ? { 'test-ui': 'src/test-ui/main.tsx' } : {}) },
    }),
    ...files.map(async ([from, to]) => {
      await mkdir(dirname(join(outDir, to)), { recursive: true });
      await copyFile(join(root, from), join(outDir, to));
    }),
    ...[...STATIC_DIRS, ...(e2e ? E2E_STATIC_DIRS : [])].map(([from, to]) => cp(join(root, from), join(outDir, to), { recursive: true })),
    writeFile(join(outDir, 'manifest.json'), JSON.stringify(buildManifest({ e2e, debug }), null, 2)),
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const e2e = process.argv.includes('--e2e');
  const debug = process.argv.includes('--debug');
  const flavor = e2e ? 'e2e' : debug ? 'debug' : 'prod';
  const outDir = join(root, 'dist', flavor);
  const workerPort = e2e ? await pickE2eWorkerPort() : undefined;
  await build({ e2e, debug, outDir, workerPort });
  if (workerPort) await writeFile(E2E_WORKER_PORT_FILE, String(workerPort));
  console.log(`built ${flavor} → ${outDir}${workerPort ? `（本機 Worker port ${workerPort}）` : ''}`);
}
