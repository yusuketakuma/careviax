import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPlaywrightChromium } from './medical-ui-e2e-preflight';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('medical UI E2E preflight', () => {
  it('fails closed when the configured Playwright Chromium executable is missing', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'phos-playwright-'));
    tempRoots.push(root);

    return expect(
      checkPlaywrightChromium({ executablePath: path.join(root, 'missing-chromium') }),
    ).resolves.toMatchObject({
      name: 'playwright:chromium',
      status: 'fail',
    });
  });

  it('passes when the configured Playwright Chromium executable exists', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'phos-playwright-'));
    tempRoots.push(root);
    const executablePath = path.join(root, 'chromium');
    writeFileSync(executablePath, 'browser');

    await expect(checkPlaywrightChromium({ executablePath })).resolves.toEqual({
      name: 'playwright:chromium',
      status: 'pass',
      detail: 'configured Chromium executable found',
    });
  });

  it('launches and closes an explicitly selected local browser channel', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const launch = vi.fn().mockResolvedValue({
      close,
      version: () => '149.0.0.0',
    });

    await expect(checkPlaywrightChromium({ channel: 'chrome', launch })).resolves.toEqual({
      name: 'playwright:chromium',
      status: 'pass',
      detail: 'explicit chrome channel launch passed (149.0.0.0)',
    });
    expect(launch).toHaveBeenCalledWith({ channel: 'chrome', headless: true });
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails closed when an explicitly selected browser channel cannot launch', async () => {
    const launch = vi.fn().mockRejectedValue(new Error('unavailable'));

    await expect(checkPlaywrightChromium({ channel: 'chrome', launch })).resolves.toEqual({
      name: 'playwright:chromium',
      status: 'fail',
      detail: 'explicit chrome channel launch failed',
    });
  });
});
