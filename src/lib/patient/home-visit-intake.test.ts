import { describe, expect, it } from 'vitest';
import {
  getHomeVisitIntake,
  getHomeVisitMedicationSupportMethods,
  getHomeVisitSpecialMedicalProcedures,
} from './home-visit-intake';

describe('home visit intake JSON readers', () => {
  it('returns null when required_visit_support or home_visit_intake is not an object', () => {
    expect(getHomeVisitIntake(null)).toBeNull();
    expect(getHomeVisitIntake([])).toBeNull();
    expect(getHomeVisitIntake({ home_visit_intake: [] })).toBeNull();
    expect(getHomeVisitIntake({ home_visit_intake: 'invalid' })).toBeNull();
  });

  it('returns the intake object for a valid required_visit_support payload', () => {
    const intake = getHomeVisitIntake({
      home_visit_intake: {
        care_level: 'care_2',
        narcotics_base: true,
      },
    });

    expect(intake).toMatchObject({
      care_level: 'care_2',
      narcotics_base: true,
    });
  });

  it('filters special procedure and medication support arrays to strings', () => {
    const requiredVisitSupport = {
      home_visit_intake: {
        special_medical_procedures: ['tpn', null, 123, 'terminal_pain'],
        medication_support_methods: ['calendar', false, 'tube'],
      },
    };

    expect(getHomeVisitSpecialMedicalProcedures(requiredVisitSupport)).toEqual([
      'tpn',
      'terminal_pain',
    ]);
    expect(getHomeVisitMedicationSupportMethods(requiredVisitSupport)).toEqual([
      'calendar',
      'tube',
    ]);
  });

  it('returns empty arrays when intake arrays are malformed or missing', () => {
    expect(
      getHomeVisitSpecialMedicalProcedures({
        home_visit_intake: { special_medical_procedures: 'tpn' },
      }),
    ).toEqual([]);
    expect(
      getHomeVisitMedicationSupportMethods({
        home_visit_intake: { medication_support_methods: { value: 'tube' } },
      }),
    ).toEqual([]);
    expect(getHomeVisitSpecialMedicalProcedures(null)).toEqual([]);
  });
});
