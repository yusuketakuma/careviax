import { describe, expect, it } from 'vitest';
import { buildPrescriptionIntakeApiPath } from './api-paths';

describe('buildPrescriptionIntakeApiPath', () => {
  it('builds prescription intake detail API paths for normal ids', () => {
    expect(buildPrescriptionIntakeApiPath('intake_1')).toBe('/api/prescription-intakes/intake_1');
  });

  it('encodes only the intake id path segment', () => {
    const intakeId = 'intake/1?tab=x#frag';

    expect(buildPrescriptionIntakeApiPath(intakeId)).toBe(
      `/api/prescription-intakes/${encodeURIComponent(intakeId)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment intake id %s', (intakeId) => {
    expect(() => buildPrescriptionIntakeApiPath(intakeId)).toThrow(RangeError);
  });
});
