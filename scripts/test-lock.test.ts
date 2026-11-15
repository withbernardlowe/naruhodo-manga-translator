import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireTestLock } from './test-lock.ts';

describe('acquireTestLock', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'test-lock-'));
    path = join(dir, 'lock');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('makes the second run wait until the first releases, and says who it waits for', async () => {
    const messages: string[] = [];
    const release = await acquireTestLock({ path });
    let secondHasLock = false;
    const second = acquireTestLock({ path, pollMs: 5, log: (m) => messages.push(m) }).then((r) => {
      secondHasLock = true;
      return r;
    });
    await expect.poll(() => messages.length).toBe(1);
    expect(secondHasLock).toBe(false);
    expect(messages[0]).toContain(`pid ${process.pid}`);

    release();
    (await second)();
    expect(existsSync(path)).toBe(false);
  });

  it('takes over a lock whose holder is gone', async () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(path, JSON.stringify({ pid: dead, cwd: 'elsewhere' }));
    const release = await acquireTestLock({ path, pollMs: 5, timeoutMs: 1000 });
    release();
    expect(existsSync(path)).toBe(false);
  });

  it('gives up after the timeout, naming the holder', async () => {
    const release = await acquireTestLock({ path });
    await expect(acquireTestLock({ path, pollMs: 5, timeoutMs: 20, log: () => {} })).rejects.toThrow(`pid ${process.pid}`);
    release();
  });
});
