# Testing

**Push it down.** Every layer up adds a browser, models, time and flakiness, so a test goes up a layer only when the layer below cannot catch what it checks. Why the browser layers are split this way: [ADR 0007](../adr/0007-browser-tests-fake-the-ocr-engine.md).

| Layer | Answers | Command | Browser + extension | OCR | LLM | Budget | When |
| --- | --- | --- | --- | --- | --- | --- | --- |
| unit | Is the rule computed right? | `npm test` | no | — | — | < 15 s | every change |
| Worker | Does the Worker's HTTP API answer right? | `npm test` (vitest project `worker`) | no | — | Anthropic faked with `vi.spyOn(fetch)` | shares unit's 15 s | every change |
| browser test | Do the pieces connect? | `npm run test:browser` | real (mock site) | FakeEngine (replayed) | FakeTranslator (in the extension, or in the local Worker) | none: much of the extension can only be checked in a browser | locally: only the specs related to the change (below); CI: all of them on every PR push |
| e2e | Still right with the real models? | `npm run e2e` | real (mock site) | real models (wasm) | FakeTranslator | none; run only when needed | see below |
| smoke | Does the real Claude API still work? | `npm run smoke` | real (mock site) | real models | real Claude API (direct, and through the local Worker) | — | only when the Claude integration changes; costs money; the key comes from 1Password (below) |
| smoke:paddle | Do a real Paddle sandbox checkout (quarterly and yearly) and a refund reach the Worker? | `npm run smoke:paddle` | real (mock site + local product site) | FakeEngine | — (Paddle sandbox: real checkout overlay, test card, webhook through a cloudflared tunnel) | — | only when the Paddle integration changes; needs `~/.config/naruhodo/paddle-sandbox.env`; takes about 15 minutes (the sandbox approves the refund after ~8); a CAPTCHA on the payment screen means stop and ask the developer |

A layer over its budget is a signal that tests have drifted up: find the ones that belong lower.

## Which browser tests to run locally

The full browser suite takes minutes, so it runs only on CI (the `browser` job, split into 4 shards, on every PR push). Locally, run only the spec files that exercise what you changed:

```
npm run test:browser -- browser/page-turn.spec.ts browser/overlay.spec.ts
```

`--` hands the files to `playwright test`; the script still builds the e2e extension and the site first. To narrow to one test, add `-g "<part of its title>"`.

Picking the files:

- The spec of the feature you touched. Files are named by feature (`page-turn`, `transcript`, `series`, `sidepanel-layout`, ...).
- The specs that use what you changed: `grep -rln "<function, message type, CSS class or UI text>" browser/`.
- A browser test you added or changed: its own file.
- A shared piece (`browser/fixtures.ts`, `browser/mock-site/`, messages between background and content script, `scripts/build.ts`, the manifest) reaches many specs: run the two or three that lean on it hardest and leave the rest to CI. Don't fall back to the full suite.
- Docs only, or a change whose behaviour only unit or Worker tests reach: no browser test locally.

Done means the CI `browser` job is green, not only your local picks: before reporting a PR done (or marking an integration branch's draft PR ready), check CI. A failure there in a spec you did not run is yours to fix, the same as a local failure. In implement-spec, ticket sessions run only their related specs; the full suite runs on CI when the integration branch's PR is pushed.

## The real Claude key (smoke, local Worker)

`npm run smoke` and `npm run worker:dev` (the local Worker on `env.dev`, real Anthropic and Paddle sandbox) run under `op run` (`scripts/with-op.ts`): the 1Password CLI resolves the key once when the command starts, puts it in `NARUHODO_ANTHROPIC_KEY` for every process underneath, and it is gone when the command ends. The key is never written to disk: not in `~/.config`, not in `worker/.dev.vars`, not in a temporary file. The local Worker gets it as `CLAUDE_API_KEY` in its environment; `env.dev`'s `secrets.required` in `worker/wrangler.jsonc` is what makes wrangler read secrets from the environment.

Each run asks for 1Password approval once. That prompt is on purpose: it is how the developer sees that an agent is spending the key. An agent runs these commands only when the developer is there to approve; a denied or timed-out approval fails the command, it does not skip.

The reference lives outside the repo in `~/.config/naruhodo/op.env`, the only place looked at; the developer creates it:

```
NARUHODO_ANTHROPIC_KEY=op://<vault>/<item>/<field>
```

Running a smoke file directly (`npx vitest`/`npx playwright test` without `op run`) skips with "已跳過". Don't name the variable `ANTHROPIC_API_KEY`: Claude Code signs in with it.

## Where a test goes

- **unit**, next to the module (`src/**/*.test.ts`): every rule and every edge case — geometry, parsing, reading order, Notes rules, cache hits, queue order, status-line text, what a backup contains. When the rule sits inside a component or a content script, pull it out into a plain function and unit-test that.
- **Worker**, next to the module (`worker/src/**/*.test.ts`): the Hosted Translation backend (ADR 0006) tested from HTTP: send a request to the real Worker, check the response and what later requests see. It runs inside workerd with local D1 (`@cloudflare/vitest-plugin`, the renamed `vitest-pool-workers`); Anthropic and Paddle are faked by `vi.spyOn(globalThis, 'fetch')` (`worker/src/test/paddle.ts` signs webhook events with the test secret); mail goes to the fake mailer (`FAKE_MAIL` in `env.dev`/`env.test`), and tests sign in by reading the code from `DEV_OUTBOX_PATH` (`worker/src/test/http.ts` has `signIn()`). Rules about tokens, quota, webhooks and what the client may not choose go here, not in browser tests. Don't query D1 directly; observe through the API. The exceptions are what the API can't show: that secrets are stored only as hashes, that usage records hold only numbers (no source text, translations, Series names or URLs) and mark Practice Spread translations, and that deleting an Account leaves nothing behind but the Free Pages grant (email hash) and its usage records with `account_id` set to NULL. A migration that rebuilds a table is tested on `MIGRATION_DB`, an empty database the test migrates only up to the previous migration, fills with old rows, then migrates the rest (`worker/src/usage-migration.test.ts`). To put an Account into a quota state (one page left, none left), use `DEV_FREE_PAGES_PATH` instead of writing to D1.
- **browser test**, in `browser/*.spec.ts`: the wiring unit cannot see — messages between content script, background, offscreen and side panel; real DOM layout; scrolling; page turns; screenshots; real downloads and file pickers. Each feature keeps **one representative path** here; its edge cases are unit tests. A new browser test names what it catches that unit cannot.
- **e2e**: a browser test tagged `{ tag: '@e2e' }` runs in both layers, with FakeEngine and with real OCR. The entry test: **would the real models change this test's result?** Yes for OCR accuracy, model download, and flows where real models run on downscaled or cropped screenshots or must ignore toolbar text; no for anything FakeEngine's replay already covers. `grep -rn "@e2e" browser/` lists the current set. A test that only means something with real models calls `test.skip(fakeOcr, ...)`.

## Regression tests for bugs found on a real site

A bug reproduced on a real manga site ([real-site debugging](real-site-debugging.md)) gets its regression test at the **lowest layer that reproduces it**. When a pure function reproduces it, copy the actual values from the trace (rects, subRects, page views) into a unit test as its data. A browser test is for bugs in the wiring itself: timing between components, messages, real layout.

## Choices made on purpose

- **Each test gets its own Chromium context and mock site**, not one shared per worker: extension state (`chrome.storage`, IndexedDB, activation) would leak into the next test and make it flaky.
- **vitest has no DOM environment** (happy-dom, jsdom): component logic is pulled out into plain functions instead, so no test depends on happy-dom behaving like real Chrome; real rendering stays in browser tests. Revisit only if a large piece of logic cannot leave the DOM.
- **The side panel opens in its own window** (`openSidePanel` in `browser/fixtures.ts`): in the page's window it would be a background tab once the page is brought to the front, its `requestAnimationFrame` stops, and every Playwright click waits about 2 seconds for the element to be stable. The real side panel is visible next to the page too.
- **Timeouts**: browser tests use the config defaults (30 s per test, 10 s per `expect`) and do not set longer ones; a slow wait under FakeEngine is a bug to fix, not a timeout to raise. The long timeouts real OCR needs live only in `playwright.e2e.config.ts`.

## When to run e2e

- Before opening the PR of an integration branch (implement-spec: once, after all tickets are merged, not in each ticket session).
- When a change touches `src/offscreen/` (models, OCR pipeline, Spread splitting, cropping).
- After `npm run record:ocr`.

Ticket sessions and ordinary changes run unit + their related browser tests only.

## FakeEngine and the recording

Browser tests replace the ONNX models with FakeEngine (`src/offscreen/fake-engine.ts`). It recognises which synthetic page it was given by comparing thumbnails, then replays what the real models returned on that page: `testdata/synthetic/recorded-ocr.json`. So browser tests see the real models' boxes and text (including their mistakes), just without running them. A segment may also carry hand-written `candidates` (code point index → that decoding step's candidates) for the Series Notes name fix (#228); re-recording keeps them while the segment's text stays the same.

Re-record when the models, detection or OCR change: `npm run site:build && npm run record:ocr`, then commit the JSON and run e2e. The same command also re-records `practice-spread/ocr.json`, the text the Worker uses to recognise the Practice Spread (real OCR on the website's practice page, wasm and WebGPU); re-record it too when the Practice Spread image changes. If FakeEngine throws "認不出這是哪張合成頁", the page it was given is not one of the recorded ranges (a new mock-site layout, or a crop the extension did not make before).

FakeEngine is near-instant. A test that relies on OCR being slow (the side panel layout before the transcript arrives) sets `test.use({ fakeOcrDelayMs })`; rules about OCR being slower than page turns, such as queue scheduling, are unit tests. Don't add a delay just to make a flaky test pass: instant OCR has already exposed a real product race on the mock e-book reader (ADR 0007).

## Flaky tests

Browser tests have no retries: FakeEngine is deterministic, so a test that fails then passes points at a real race in the extension or the test. Fix it, or mark it `test.fixme(...)` with the reason and open an issue; do not add retries. e2e retries once, because real OCR speed depends on machine load.

Load is the other cause, and it is not a race: when every failure is a timeout and a different set of tests fails each run, the machine is overloaded. These keep it from happening:

- **Only the related specs locally** (above), so a local run is short and rarely overlaps another worktree's.
- **One worker locally** (`playwright.config.ts`). Each test launches a whole Chromium (the extension needs `launchPersistentContext`), so on a laptop more workers mostly make each test slower: on the same 11 tests with nothing else running, 4 workers took each test from about 10 s to 20 s, the run was no shorter, and 3 different tests timed out per run, while 1 worker passed every time. One worker also keeps several worktrees running at once down to one browser each. Don't pass a higher `--workers`. CI keeps the Playwright default per machine and instead splits the run across 4 machines (`--shard`, the `browser` job's matrix in `.github/workflows/ci.yml`).

There is no lock between runs (an interrupted run used to leave it held), so worktrees can run browser tests at the same time. The extension connects to the local Worker at a port baked in at build time: `npm run build:e2e` picks a free one in 8788–8887, starting from a point derived from the worktree's path, and writes it to `dist/e2e-worker-port`, which `browser/worker.ts` reads (`pickE2eWorkerPort` in `scripts/build.ts`). If another run takes that port between the build and the Worker starting, the run fails at once with `已經有東西在跑`; rerun it, and the build picks another port. Every concurrent run still adds load.

A debug Chrome doing real-site work at the same time still adds load; if a full run times out while it is busy, rerun when it is idle before treating the failure as a race.

Fixed delays follow [CODING_STANDARDS.md](../../CODING_STANDARDS.md): wait on a condition, except when asserting that something did *not* happen.
