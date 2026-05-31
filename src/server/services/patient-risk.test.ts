import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  patientFindManyMock,
  careCaseFindManyMock,
  selfReportFindManyMock,
  medicationIssueFindManyMock,
  taskFindManyMock,
  visitScheduleFindManyMock,
  careReportFindManyMock,
  consentRecordFindManyMock,
  managementPlanFindManyMock,
} = vi.hoisted(() => ({
  patientFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  selfReportFindManyMock: vi.fn(),
  medicationIssueFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  consentRecordFindManyMock: vi.fn(),
  managementPlanFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

import { listPatientRiskSummaries, getPatientRiskSummary } from './patient-risk';

function makeDb() {
  return {
    patient: { findMany: patientFindManyMock },
    careCase: { findMany: careCaseFindManyMock },
    patientSelfReport: { findMany: selfReportFindManyMock },
    medicationIssue: { findMany: medicationIssueFindManyMock },
    task: { findMany: taskFindManyMock },
    visitSchedule: { findMany: visitScheduleFindManyMock },
    careReport: { findMany: careReportFindManyMock },
    consentRecord: { findMany: consentRecordFindManyMock },
    managementPlan: { findMany: managementPlanFindManyMock },
  };
}

describe('listPatientRiskSummaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no patients found', async () => {
    patientFindManyMock.mockResolvedValue([]);

    const result = await listPatientRiskSummaries(makeDb(), {
      orgId: 'org-1',
    });

    expect(result).toEqual([]);
  });

  it('returns empty array without PHI reads when an explicit patient scope is empty', async () => {
    const result = await listPatientRiskSummaries(makeDb(), {
      orgId: 'org-1',
      patientIds: [],
      caseIdsByPatient: {},
    });

    expect(result).toEqual([]);
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(selfReportFindManyMock).not.toHaveBeenCalled();
    expect(medicationIssueFindManyMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(careReportFindManyMock).not.toHaveBeenCalled();
    expect(consentRecordFindManyMock).not.toHaveBeenCalled();
    expect(managementPlanFindManyMock).not.toHaveBeenCalled();
  });

  it('limits explicit patient scope before enrichment reads when a candidate limit is provided', async () => {
    patientFindManyMock.mockResolvedValue([
      { id: 'p-1', name: '田中太郎', billing_support_flag: false },
    ]);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case-1', patient_id: 'p-1' }]);
    selfReportFindManyMock.mockResolvedValue([]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    consentRecordFindManyMock.mockResolvedValue([]);
    managementPlanFindManyMock.mockResolvedValue([{ case_id: 'case-1' }]);

    const result = await listPatientRiskSummaries(makeDb(), {
      orgId: 'org-1',
      patientIds: ['p-1', 'p-2'],
      caseIdsByPatient: { 'p-1': ['case-1'], 'p-2': ['case-2'] },
      candidateLimit: 1,
      includeStable: true,
    });

    expect(result).toHaveLength(1);
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['p-1'] },
        }),
      }),
    );
    expect(careCaseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: ['p-1'] },
          id: { in: ['case-1'] },
        }),
      }),
    );
    expect(medicationIssueFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { patient_id: 'p-1', case_id: null },
            { patient_id: 'p-1', case_id: { in: ['case-1'] } },
          ],
        }),
      }),
    );
  });

  it('computes stable score for patient with no issues', async () => {
    patientFindManyMock.mockResolvedValue([
      { id: 'p-1', name: '田中太郎', billing_support_flag: false },
    ]);
    careCaseFindManyMock.mockResolvedValue([]);
    selfReportFindManyMock.mockResolvedValue([]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    consentRecordFindManyMock.mockResolvedValue([]);
    managementPlanFindManyMock.mockResolvedValue([]);

    const result = await listPatientRiskSummaries(makeDb(), {
      orgId: 'org-1',
      includeStable: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0);
    expect(result[0].level).toBe('stable');
    expect(result[0].reasons).toEqual([]);
  });

  it('scores high when missing consent and plan with active case', async () => {
    patientFindManyMock.mockResolvedValue([
      { id: 'p-1', name: '佐藤花子', billing_support_flag: false },
    ]);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case-1', patient_id: 'p-1' }]);
    selfReportFindManyMock.mockResolvedValue([]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    consentRecordFindManyMock.mockResolvedValue([]);
    managementPlanFindManyMock.mockResolvedValue([]);

    const result = await listPatientRiskSummaries(makeDb(), {
      orgId: 'org-1',
      includeStable: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(4); // +2 consent + 2 plan
    expect(result[0].level).toBe('watch');
    expect(result[0].missing_visit_consent).toBe(true);
    expect(result[0].missing_management_plan).toBe(true);
  });

  it('adds score for self reports with callback', async () => {
    patientFindManyMock.mockResolvedValue([
      { id: 'p-1', name: '山田一郎', billing_support_flag: false },
    ]);
    careCaseFindManyMock.mockResolvedValue([]);
    selfReportFindManyMock.mockResolvedValue([{ patient_id: 'p-1', requested_callback: true }]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    consentRecordFindManyMock.mockResolvedValue([]);
    managementPlanFindManyMock.mockResolvedValue([]);

    const result = await listPatientRiskSummaries(makeDb(), {
      orgId: 'org-1',
      includeStable: true,
    });

    expect(result[0].score).toBe(2);
    expect(result[0].unresolved_self_reports).toBe(1);
  });

  it('filters out stable patients by default', async () => {
    patientFindManyMock.mockResolvedValue([
      { id: 'p-1', name: '安定太郎', billing_support_flag: false },
    ]);
    careCaseFindManyMock.mockResolvedValue([]);
    selfReportFindManyMock.mockResolvedValue([]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    consentRecordFindManyMock.mockResolvedValue([]);
    managementPlanFindManyMock.mockResolvedValue([]);

    const result = await listPatientRiskSummaries(makeDb(), {
      orgId: 'org-1',
    });

    expect(result).toEqual([]);
  });

  it('adds billing_support_flag score', async () => {
    patientFindManyMock.mockResolvedValue([
      { id: 'p-1', name: '請求太郎', billing_support_flag: true },
    ]);
    careCaseFindManyMock.mockResolvedValue([]);
    selfReportFindManyMock.mockResolvedValue([]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    consentRecordFindManyMock.mockResolvedValue([]);
    managementPlanFindManyMock.mockResolvedValue([]);

    const result = await listPatientRiskSummaries(makeDb(), {
      orgId: 'org-1',
      includeStable: true,
    });

    expect(result[0].score).toBe(1);
    expect(result[0].reasons).toContain('請求支援フラグが設定されています');
  });
});

describe('getPatientRiskSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when patient not found', async () => {
    patientFindManyMock.mockResolvedValue([]);

    const result = await getPatientRiskSummary(makeDb(), {
      orgId: 'org-1',
      patientId: 'nonexistent',
    });

    expect(result).toBeNull();
  });

  it('returns single patient summary', async () => {
    patientFindManyMock.mockResolvedValue([
      { id: 'p-1', name: '鈴木太郎', billing_support_flag: false },
    ]);
    careCaseFindManyMock.mockResolvedValue([]);
    selfReportFindManyMock.mockResolvedValue([]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    consentRecordFindManyMock.mockResolvedValue([]);
    managementPlanFindManyMock.mockResolvedValue([]);

    const result = await getPatientRiskSummary(makeDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
    });

    expect(result).not.toBeNull();
    expect(result!.patient_id).toBe('p-1');
  });
});
