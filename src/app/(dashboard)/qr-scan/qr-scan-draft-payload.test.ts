import { describe, expect, it } from 'vitest';
import {
  buildQrScanDraftPayload,
  qrScanDraftSessionIdResponseSchema,
} from './qr-scan-draft-payload';

describe('buildQrScanDraftPayload', () => {
  it('includes the required site_id for QR scan draft creation', () => {
    expect(
      buildQrScanDraftPayload({
        qrTexts: ['JAHISTC1'],
        patientId: 'patient_1',
        siteId: ' site_1 ',
        sessionId: 'session_1',
      }),
    ).toEqual({
      qr_texts: ['JAHISTC1'],
      patient_id: 'patient_1',
      site_id: 'site_1',
      session_id: 'session_1',
    });
  });

  it('omits session_id for the first QR scan draft submission', () => {
    expect(
      buildQrScanDraftPayload({
        qrTexts: ['JAHISTC1'],
        patientId: 'patient_1',
        siteId: 'site_1',
      }),
    ).toEqual({
      qr_texts: ['JAHISTC1'],
      patient_id: 'patient_1',
      site_id: 'site_1',
    });
  });

  it('rejects draft creation without an active site context', () => {
    expect(() =>
      buildQrScanDraftPayload({
        qrTexts: ['JAHISTC1'],
        patientId: 'patient_1',
        siteId: '   ',
      }),
    ).toThrow('店舗が未設定です');
  });
});

describe('qrScanDraftSessionIdResponseSchema', () => {
  it('reads and normalizes the session id from the provider data envelope', () => {
    expect(
      qrScanDraftSessionIdResponseSchema.parse({
        data: {
          draft: { id: 'draft_1' },
          parse_result: { success: true },
          session_id: ' session_1 ',
        },
      }),
    ).toBe('session_1');
  });

  it('rejects the legacy root create response', () => {
    expect(
      qrScanDraftSessionIdResponseSchema.safeParse({ session_id: 'legacy_session' }).success,
    ).toBe(false);
  });

  it.each([
    {},
    { data: null },
    { data: {} },
    { data: { session_id: '   ' } },
    { data: { session_id: 'session_1' }, unexpected_root: true },
  ])('rejects a malformed create response %#', (payload) => {
    expect(qrScanDraftSessionIdResponseSchema.safeParse(payload).success).toBe(false);
  });
});
