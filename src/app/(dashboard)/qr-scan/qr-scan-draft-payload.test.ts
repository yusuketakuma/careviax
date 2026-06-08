import { describe, expect, it } from 'vitest';
import { buildQrScanDraftPayload } from './qr-scan-draft-payload';

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
