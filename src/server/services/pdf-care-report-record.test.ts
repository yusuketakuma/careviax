import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCareReportRecord } from '@/server/services/pdf-care-report-record';
import { PdfNotFoundError } from './pdf-errors';

const { careReportFindFirstMock, patientFindFirstMock, visitRecordFindFirstMock, canAccessMock } =
  vi.hoisted(() => ({
    careReportFindFirstMock: vi.fn(),
    patientFindFirstMock: vi.fn(),
    visitRecordFindFirstMock: vi.fn(),
    canAccessMock: vi.fn(),
  }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careReport: {
      findFirst: careReportFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/patient-access', () => ({
  canAccessCaseScopedPatientResource: canAccessMock,
}));

const baseReport = {
  id: 'report_1',
  patient_id: 'patient_1',
  case_id: 'case_1',
  visit_record_id: null,
  report_type: 'physician_report',
  status: 'draft',
  content: { note: '報告内容' },
  created_at: new Date(2026, 3, 1),
  updated_at: new Date(2026, 3, 2),
};

describe('getCareReportRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canAccessMock.mockResolvedValue(true);
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date(1940, 0, 1),
      gender: 'male',
      archived_at: null,
    });
  });

  it('throws a PDF-safe not-found error when the report is unavailable', async () => {
    careReportFindFirstMock.mockResolvedValue(null);

    await expect(getCareReportRecord('org_1', 'report_1')).rejects.toBeInstanceOf(PdfNotFoundError);

    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(canAccessMock).not.toHaveBeenCalled();
  });

  it('checks visit-record scoped access before loading patient details', async () => {
    careReportFindFirstMock.mockResolvedValue({
      ...baseReport,
      visit_record_id: 'visit_record_1',
    });
    visitRecordFindFirstMock.mockResolvedValue(null);

    await expect(
      getCareReportRecord('org_1', 'report_1', {
        userId: 'pharmacist_1',
        role: 'pharmacist',
      }),
    ).rejects.toBeInstanceOf(PdfNotFoundError);

    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_record_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        schedule: {
          case_id: 'case_1',
          case_: {
            patient_id: 'patient_1',
          },
        },
      },
      select: { id: true },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
  });

  it('checks case-scoped patient access for reports without a visit record', async () => {
    careReportFindFirstMock.mockResolvedValue(baseReport);
    canAccessMock.mockResolvedValue(false);

    await expect(
      getCareReportRecord('org_1', 'report_1', {
        userId: 'pharmacist_1',
        role: 'pharmacist',
      }),
    ).rejects.toBeInstanceOf(PdfNotFoundError);

    expect(canAccessMock).toHaveBeenCalledWith({
      db: expect.any(Object),
      orgId: 'org_1',
      patientId: 'patient_1',
      caseId: 'case_1',
      accessContext: {
        userId: 'pharmacist_1',
        role: 'pharmacist',
      },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns the normalized care report record for accessible reports', async () => {
    careReportFindFirstMock.mockResolvedValue(baseReport);

    await expect(getCareReportRecord('org_1', 'report_1')).resolves.toMatchObject({
      id: 'report_1',
      report_type: 'physician_report',
      status: 'draft',
      content: { note: '報告内容' },
      patient: {
        id: 'patient_1',
        name: '山田 太郎',
        archive: { status: 'active', archived: false, archived_at: null },
      },
    });

    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: {
        id: true,
        name: true,
        birth_date: true,
        gender: true,
        archived_at: true,
      },
    });
  });

  it('returns archived-patient state without exposing archive ownership', async () => {
    careReportFindFirstMock.mockResolvedValue(baseReport);
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date(1940, 0, 1),
      gender: 'male',
      archived_at: new Date('2026-06-30T09:00:00.000Z'),
      archived_by: 'internal_user',
    });

    const record = await getCareReportRecord('org_1', 'report_1');

    expect(record.patient.archive).toEqual({
      status: 'archived',
      archived: true,
      archived_at: '2026-06-30T09:00:00.000Z',
    });
    expect(record.patient).not.toHaveProperty('archived_at');
    expect(record.patient).not.toHaveProperty('archived_by');
    expect(JSON.stringify(record)).not.toContain('internal_user');
  });
});
