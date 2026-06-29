import { describe, expect, it } from 'vitest';
import { getPatientCareQueryKeys, getVisitExecutionQueryKeys } from './query-invalidations';

describe('query-invalidations', () => {
  it('returns patient-care keys with org-aware invalidation targets', () => {
    expect(
      getPatientCareQueryKeys({
        orgId: 'org_1',
        patientId: 'patient_1',
      }),
    ).toEqual(
      expect.arrayContaining([
        ['patient', 'patient_1', 'org_1'],
        ['patients', 'org_1'],
        ['patient-visit-records', 'patient_1', 'org_1'],
        ['visit-constraints', 'org_1', 'patient_1'],
        ['dashboard', 'patients', 'org_1'],
        ['visit-schedules', 'calendar', 'org_1'],
      ]),
    );
  });

  it('extends visit execution invalidation with schedule and dashboard keys', () => {
    expect(
      getVisitExecutionQueryKeys({
        orgId: 'org_1',
        patientId: 'patient_1',
        scheduleId: 'schedule_1',
      }),
    ).toEqual(
      expect.arrayContaining([
        ['schedule', 'schedule_1', 'org_1'],
        ['dashboard', 'actions', 'org_1'],
        ['dashboard-workflow', 'org_1'],
        ['tasks', 'schedule-board', 'org_1'],
      ]),
    );
  });
});
