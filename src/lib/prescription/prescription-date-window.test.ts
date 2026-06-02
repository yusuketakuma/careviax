import { describe, expect, it } from 'vitest';
import { validatePrescriptionDateWindow } from './prescription-date-window';

describe('prescription date window', () => {
  it('rejects future prescribed dates in the pharmacy timezone', () => {
    expect(
      validatePrescriptionDateWindow('2026-06-02', new Date('2026-06-01T23:00:00+09:00')),
    ).toEqual({ ok: false, reason: 'future_prescribed_date' });
  });

  it('keeps the fourth calendar day valid through the local day boundary', () => {
    expect(
      validatePrescriptionDateWindow('2026-06-01', new Date('2026-06-05T23:59:59+09:00')),
    ).toEqual({ ok: true });
  });

  it('rejects the first calendar day after the prescription validity window', () => {
    expect(
      validatePrescriptionDateWindow('2026-06-01', new Date('2026-06-06T00:00:00+09:00')),
    ).toEqual({ ok: false, reason: 'expiry_exceeded' });
  });
});
