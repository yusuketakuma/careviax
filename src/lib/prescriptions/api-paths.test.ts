import { describe, expect, it } from 'vitest';
import { buildMedicationCycleHistoryApiPath, buildPrescriptionIntakeApiPath } from './api-paths';

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

describe('buildMedicationCycleHistoryApiPath', () => {
  it('encodes the cycle id as one path segment', () => {
    const cycleId = 'cycle/1?tab=history#frag';
    expect(buildMedicationCycleHistoryApiPath(cycleId)).toBe(
      `/api/medication-cycles/${encodeURIComponent(cycleId)}/history`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment cycle id %s', (cycleId) => {
    expect(() => buildMedicationCycleHistoryApiPath(cycleId)).toThrow(RangeError);
  });
});
