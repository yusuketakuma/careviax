import { describe, expect, it } from 'vitest';
import { classifyHomeVisitIntakePatch } from './home-visit-intake-patch';

describe('classifyHomeVisitIntakePatch', () => {
  it('omits absent and structurally empty nested patches', () => {
    expect(classifyHomeVisitIntakePatch({})).toEqual({
      hasRequesterWrites: false,
      hasSchedulePreferenceWrites: false,
      hasCareCaseWrites: false,
      hasAnyWrites: false,
    });
    expect(classifyHomeVisitIntakePatch({ requester: {}, intake: {} })).toEqual({
      hasRequesterWrites: false,
      hasSchedulePreferenceWrites: false,
      hasCareCaseWrites: false,
      hasAnyWrites: false,
    });
  });

  it('treats blank, null, and empty-array values as intentional clears', () => {
    expect(
      classifyHomeVisitIntakePatch({
        requester: { organization_name: '', phone: null },
        intake: {
          contact_phone: null,
          first_visit_time_note: '',
          special_medical_procedures: [],
        },
      }),
    ).toEqual({
      hasRequesterWrites: true,
      hasSchedulePreferenceWrites: true,
      hasCareCaseWrites: true,
      hasAnyWrites: true,
    });
  });

  it('classifies schedule-only clears independently from CareCase writes', () => {
    expect(
      classifyHomeVisitIntakePatch({
        intake: { infection_isolation: '' },
      }),
    ).toEqual({
      hasRequesterWrites: false,
      hasSchedulePreferenceWrites: true,
      hasCareCaseWrites: false,
      hasAnyWrites: true,
    });
  });
});
