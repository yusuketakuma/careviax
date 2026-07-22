import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

const getPatientRiskSummaryMock = vi.hoisted(() => vi.fn());
const getPatientVisitBriefMock = vi.hoisted(() => vi.fn());
const getPatientHomeCareFeatureSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/patient-risk', () => ({
  getPatientRiskSummary: getPatientRiskSummaryMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getPatientVisitBrief: getPatientVisitBriefMock,
}));

vi.mock('@/server/services/home-care-ops', () => ({
  getPatientHomeCareFeatureSummary: getPatientHomeCareFeatureSummaryMock,
}));

import { getPatientVisitsData } from './patient-detail';
import { buildDb } from './patient-detail.test-support';

beforeEach(() => {
  vi.clearAllMocks();
  getPatientRiskSummaryMock.mockResolvedValue({
    level: 'low',
    score: 0,
    factors: [],
  });
  getPatientVisitBriefMock.mockResolvedValue(null);
  getPatientHomeCareFeatureSummaryMock.mockResolvedValue({
    states: [],
    highlights: [],
  });
});

describe('getPatientVisitsData', () => {
  it('scopes visit schedules, counts, and records to the assigned case ids', async () => {
    const visitScheduleFindManyMock = vi.fn().mockResolvedValue([{ id: 'schedule_1' }]);
    const visitScheduleCountMock = vi.fn().mockResolvedValue(2);
    const visitRecordFindManyMock = vi.fn().mockResolvedValue([{ id: 'record_1' }]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: {
        findMany: visitScheduleFindManyMock,
        count: visitScheduleCountMock,
      },
      visitRecord: {
        findMany: visitRecordFindManyMock,
      },
    });

    const result = await getPatientVisitsData(
      db as unknown as Parameters<typeof getPatientVisitsData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result).toEqual({
      monthly_visit_count: 2,
      visit_schedules: [{ id: 'schedule_1' }],
      visit_records: [{ id: 'record_1' }],
      home_care_feature_summary: {
        states: [],
        highlights: [],
      },
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: { in: ['case_1'] },
        }),
      }),
    );
    expect(visitScheduleCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: { in: ['case_1'] },
          scheduled_date: {
            gte: expect.any(Date),
            lt: expect.any(Date),
          },
        }),
      }),
    );
    expect(visitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          schedule: {
            case_id: { in: ['case_1'] },
          },
        }),
      }),
    );
  });

  it('skips visit fan-out queries when the patient has no assigned cases', async () => {
    const visitScheduleFindManyMock = vi.fn();
    const visitScheduleCountMock = vi.fn();
    const visitRecordFindManyMock = vi.fn();
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [],
        }),
      },
      visitSchedule: {
        findMany: visitScheduleFindManyMock,
        count: visitScheduleCountMock,
      },
      visitRecord: {
        findMany: visitRecordFindManyMock,
      },
    });

    const result = await getPatientVisitsData(
      db as unknown as Parameters<typeof getPatientVisitsData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result).toMatchObject({
      monthly_visit_count: 0,
      visit_schedules: [],
      visit_records: [],
    });
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
  });
});
