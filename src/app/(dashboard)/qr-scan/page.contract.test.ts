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

  it('passes the active site context to QR draft creation', () => {
    expect(SOURCE).toContain("import { useAuthStore } from '@/lib/stores/auth-store';");
    expect(SOURCE).toContain('const siteId = useAuthStore((state) => state.siteId);');
    expect(SOURCE).toContain('buildQrScanDraftPayload({');
    expect(SOURCE).toContain('siteId,');
  });

  it('uses the minimal patient match view for QR patient lookup', () => {
    expect(SOURCE).toContain('/api/patients?view=match&q=');
    expect(SOURCE).toContain('&limit=10');
  });

  it('stops the ZXing continuous-decode controls when the camera is torn down', () => {
    // decodeFromVideoElement returns IScannerControls; it must be retained and stopped
    // so the decode loop and its callback do not leak after stopCamera / unmount.
    expect(SOURCE).toContain('controlsRef');
    expect(SOURCE).toContain('const controls = await reader.decodeFromVideoElement(');
    expect(SOURCE).toContain('controlsRef.current = controls;');
    expect(SOURCE).toContain('controlsRef.current.stop();');
  });

  it('ignores ZXing decode callbacks once the camera lifecycle is cancelled', () => {
    // ZXing may start scan() before returning controls, so the callback itself must
    // bail out on cancellation to avoid setState/navigation after teardown.
    expect(SOURCE).toMatch(/decodeFromVideoElement\([\s\S]*?if \(isCancelled\?\.\(\)\) return;/);
  });

  it('guards startCamera against unmount/phase-change races', () => {
    // In-flight getUserMedia/import must not assign a stream or call setState after teardown.
    expect(SOURCE).toContain('async (isCancelled?: () => boolean)');
    expect(SOURCE).toContain('if (isCancelled?.()) {');
    expect(SOURCE).toContain('stream.getTracks().forEach((t) => t.stop());');
    expect(SOURCE).toContain('let cancelled = false;');
    expect(SOURCE).toContain('startCamera(() => cancelled)');
    // The retry button must not pass the click event as the cancellation predicate.
    expect(SOURCE).toContain('onClick={() => startCamera()}');
  });

  it('revokes the uploaded image object URL even when decoding fails', () => {
    expect(SOURCE).toContain('} finally {');
    expect(SOURCE).toContain('URL.revokeObjectURL(url);');
  });
});
