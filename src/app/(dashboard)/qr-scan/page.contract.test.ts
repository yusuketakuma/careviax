import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

describe('QRScanPage accessibility status contract', () => {
  it('announces blocking scan and send errors as alerts', () => {
    expect(SOURCE).toContain('role="alert"');
    expect(SOURCE).toContain('aria-live="assertive"');
    expect(SOURCE).toContain('{cameraError}');
    expect(SOURCE).toContain('{sendError}');
  });

  it('announces non-blocking scan progress and successful send state as status messages', () => {
    expect(SOURCE).toContain('role="status"');
    expect(SOURCE).toContain('aria-live="polite"');
    expect(SOURCE).toContain('{progressLabel}');
    expect(SOURCE).toContain('PCに送信しました');
  });

  it('keeps QR parse warnings and parse errors in live regions', () => {
    expect(SOURCE).toContain('解析時の確認事項');
    expect(SOURCE).toContain('parseResult.warnings.length > 0');
    expect(SOURCE).toContain('parseResult.errors.length > 0');
  });
});
