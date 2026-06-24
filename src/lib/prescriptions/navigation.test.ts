import { describe, expect, it } from 'vitest';
import { buildPrescriptionHref } from './navigation';

describe('buildPrescriptionHref', () => {
  it('encodes only the prescription intake id path segment', () => {
    const prescriptionIntakeId = 'intake/1?tab=x#frag';

    expect(buildPrescriptionHref(prescriptionIntakeId)).toBe(
      `/prescriptions/${encodeURIComponent(prescriptionIntakeId)}`,
    );
  });

  it('builds the prescription detail route for normal ids', () => {
    expect(buildPrescriptionHref('intake_1')).toBe('/prescriptions/intake_1');
  });

  it.each(['.', '..'])(
    'rejects exact dot-segment prescription intake id %s',
    (prescriptionIntakeId) => {
      expect(() => buildPrescriptionHref(prescriptionIntakeId)).toThrow(RangeError);
    },
  );
});
