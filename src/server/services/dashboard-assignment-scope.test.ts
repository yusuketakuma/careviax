import { describe, expect, it } from 'vitest';
import {
  buildDashboardTaskAssignmentWhere,
  canCreateTaskInDashboardAssignmentScope,
} from './dashboard-assignment-scope';

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

describe('canCreateTaskInDashboardAssignmentScope', () => {
  const personalScope = {
    caseIds: ['case_1'],
    patientIds: ['patient_1'],
    assignedToUserId: 'user_1',
  };

  it('allows owner/admin-style unrestricted task creation', () => {
    expect(
      canCreateTaskInDashboardAssignmentScope(
        {
          caseIds: undefined,
          patientIds: undefined,
          assignedToUserId: undefined,
        },
        {
          assigned_to: 'user_2',
          related_entity_type: 'patient',
          related_entity_id: 'patient_2',
        },
      ),
    ).toBe(true);
  });

  it.each([
    ['patient', 'patient_1'],
    ['case', 'case_1'],
  ])('allows an unassigned task for a personally assigned %s', (relatedEntityType, id) => {
    expect(
      canCreateTaskInDashboardAssignmentScope(personalScope, {
        related_entity_type: relatedEntityType,
        related_entity_id: id,
      }),
    ).toBe(true);
  });

  it.each([
    ['patient', 'patient_2'],
    ['case', 'case_2'],
  ])('rejects an unassigned task for an out-of-scope %s', (relatedEntityType, id) => {
    expect(
      canCreateTaskInDashboardAssignmentScope(personalScope, {
        related_entity_type: relatedEntityType,
        related_entity_id: id,
      }),
    ).toBe(false);
  });

  it('allows a self-assigned task without a related resource', () => {
    expect(
      canCreateTaskInDashboardAssignmentScope(personalScope, {
        assigned_to: 'user_1',
      }),
    ).toBe(true);
  });

  it.each([
    [{ assigned_to: 'user_2' }],
    [{ related_entity_type: 'unknown', related_entity_id: 'resource_1' }],
  ])('rejects personal-scope tasks that have no qualifying assignment (%j)', (task) => {
    expect(canCreateTaskInDashboardAssignmentScope(personalScope, task)).toBe(false);
  });

  it('rejects another assignee even when the related patient is in scope', () => {
    expect(
      canCreateTaskInDashboardAssignmentScope(personalScope, {
        assigned_to: 'user_2',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    ).toBe(false);
  });
});
