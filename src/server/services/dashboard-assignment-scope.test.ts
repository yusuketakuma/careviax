import { describe, expect, it } from 'vitest';
import { buildDashboardTaskAssignmentWhere } from './dashboard-assignment-scope';

describe('buildDashboardTaskAssignmentWhere', () => {
  it('includes tasks explicitly assigned to the scoped user alongside patient and case tasks', () => {
    expect(
      buildDashboardTaskAssignmentWhere({
        caseIds: ['case_1'],
        patientIds: ['patient_1'],
        assignedToUserId: 'user_1',
      }),
    ).toEqual({
      OR: [
        { assigned_to: 'user_1' },
        { related_entity_type: 'patient', related_entity_id: { in: ['patient_1'] } },
        { related_entity_type: 'case', related_entity_id: { in: ['case_1'] } },
      ],
    });
  });
});
