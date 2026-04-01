import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  visitRecordFindFirstMock,
  visitScheduleFindUniqueMock,
  patientFindFirstMock,
  medicationCycleFindFirstMock,
  residualMedicationFindManyMock,
  careTeamLinkFindManyMock,
  userFindFirstMock,
  billingEvidenceFindFirstMock,
  careCaseFindFirstMock,
  prescriptionLineFindManyMock,
  careReportFindManyMock,
  careReportCreateMock,
  buildPhysicianReportMock,
  buildCareManagerReportMock,
  withOrgContextMock,
  getHomeVisitIntakeMock,
} = vi.hoisted(() => ({
  visitRecordFindFirstMock: vi.fn(),
  visitScheduleFindUniqueMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  residualMedicationFindManyMock: vi.fn(),
  careTeamLinkFindManyMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  billingEvidenceFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  prescriptionLineFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  careReportCreateMock: vi.fn(),
  buildPhysicianReportMock: vi.fn(),
  buildCareManagerReportMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  getHomeVisitIntakeMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: { findFirst: visitRecordFindFirstMock },
    visitSchedule: { findUnique: visitScheduleFindUniqueMock },
    patient: { findFirst: patientFindFirstMock },
    medicationCycle: { findFirst: medicationCycleFindFirstMock },
    residualMedication: { findMany: residualMedicationFindManyMock },
    careTeamLink: { findMany: careTeamLinkFindManyMock },
    user: { findFirst: userFindFirstMock },
    billingEvidence: { findFirst: billingEvidenceFindFirstMock },
    careCase: { findFirst: careCaseFindFirstMock },
    prescriptionLine: { findMany: prescriptionLineFindManyMock },
    careReport: { findMany: careReportFindManyMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('./report-templates', () => ({
  buildPhysicianReport: buildPhysicianReportMock,
  buildCareManagerReport: buildCareManagerReportMock,
}));

vi.mock('@/lib/patient/home-visit-intake', () => ({
  getHomeVisitIntake: getHomeVisitIntakeMock,
}));

import { generateReportsFromVisit } from './report-generator';

describe('generateReportsFromVisit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHomeVisitIntakeMock.mockReturnValue(null);
  });

  it('throws when visit record not found', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    await expect(
      generateReportsFromVisit('org-1', 'user-1', 'vr-missing')
    ).rejects.toThrow('VisitRecord not found');
  });

  it('throws when visit schedule not found', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: null,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue(null);

    await expect(
      generateReportsFromVisit('org-1', 'user-1', 'vr-1')
    ).rejects.toThrow('VisitSchedule not found');
  });

  it('throws when schedule org_id does not match', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: null,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      org_id: 'org-WRONG',
    });

    await expect(
      generateReportsFromVisit('org-1', 'user-1', 'vr-1')
    ).rejects.toThrow('VisitSchedule not found');
  });

  it('returns existing reports without creating new ones', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: null,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '田中太郎',
      birth_date: new Date('1950-01-01'),
      gender: 'male',
    });
    medicationCycleFindFirstMock.mockResolvedValue(null);
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ name: '薬剤師A' });
    billingEvidenceFindFirstMock.mockResolvedValue({ payer_basis: 'medical' });
    careCaseFindFirstMock.mockResolvedValue({ required_visit_support: null });
    prescriptionLineFindManyMock.mockResolvedValue([]);
    buildPhysicianReportMock.mockReturnValue({ title: 'report' });

    // Report already exists
    careReportFindManyMock.mockResolvedValue([
      { id: 'report-existing', report_type: 'physician_report' },
    ]);

    const result = await generateReportsFromVisit('org-1', 'user-1', 'vr-1');

    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].id).toBe('report-existing');
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('creates physician_report when not existing', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-1',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: null,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '田中太郎',
      birth_date: new Date('1950-01-01'),
      gender: 'male',
    });
    medicationCycleFindFirstMock.mockResolvedValue(null);
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ name: '薬剤師A' });
    billingEvidenceFindFirstMock.mockResolvedValue({ payer_basis: 'medical' });
    careCaseFindFirstMock.mockResolvedValue({ required_visit_support: null });
    prescriptionLineFindManyMock.mockResolvedValue([]);
    buildPhysicianReportMock.mockReturnValue({ title: 'physician report' });
    careReportFindManyMock.mockResolvedValue([]);

    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        careReport: {
          create: careReportCreateMock.mockResolvedValue({
            id: 'report-new',
            report_type: 'physician_report',
          }),
        },
      };
      return fn(tx);
    });

    const result = await generateReportsFromVisit('org-1', 'user-1', 'vr-1');

    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].report_type).toBe('physician_report');
    expect(withOrgContextMock).toHaveBeenCalledOnce();
  });

  it('throws when patient not found', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr-1',
      org_id: 'org-1',
      patient_id: 'p-missing',
      pharmacist_id: 'pharm-1',
      visit_date: new Date(),
      structured_soap: null,
      schedule_id: 'vs-1',
    });
    visitScheduleFindUniqueMock.mockResolvedValue({
      case_id: 'case-1',
      org_id: 'org-1',
    });
    patientFindFirstMock.mockResolvedValue(null);
    medicationCycleFindFirstMock.mockResolvedValue(null);
    residualMedicationFindManyMock.mockResolvedValue([]);
    careTeamLinkFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue(null);
    billingEvidenceFindFirstMock.mockResolvedValue(null);
    careCaseFindFirstMock.mockResolvedValue(null);

    await expect(
      generateReportsFromVisit('org-1', 'user-1', 'vr-1')
    ).rejects.toThrow('Patient not found');
  });
});
