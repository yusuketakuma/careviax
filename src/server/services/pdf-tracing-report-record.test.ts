import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTracingReportRecord } from '@/server/services/pdf-tracing-report-record';
import { PdfNotFoundError } from './pdf-errors';

const { patientFindFirstMock, tracingReportFindFirstMock, canAccessMock } = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  canAccessMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    tracingReport: {
      findFirst: tracingReportFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/patient-access', () => ({
  canAccessCaseScopedPatientResource: canAccessMock,
}));

const baseReport = {
  id: 'tracing_1',
  patient_id: 'patient_1',
  case_id: 'case_1',
  status: 'draft',
  sent_to_physician: null,
  sent_at: null,
  acknowledged_at: null,
  created_at: new Date(2026, 3, 1),
  updated_at: new Date(2026, 3, 2),
  content: { message: '服薬状況を共有' },
  issue: {
    org_id: 'org_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    title: '副作用確認',
    description: '眠気あり',
    priority: 'high',
    status: 'open',
  },
};

describe('getTracingReportRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canAccessMock.mockResolvedValue(true);
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date(1940, 0, 1),
      gender: 'male',
    });
  });

  it('throws a PDF-safe not-found error when the report is unavailable', async () => {
    tracingReportFindFirstMock.mockResolvedValue(null);

    await expect(getTracingReportRecord('org_1', 'tracing_1')).rejects.toBeInstanceOf(
      PdfNotFoundError,
    );

    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(canAccessMock).not.toHaveBeenCalled();
  });

  it('checks scoped patient access before loading patient details', async () => {
    tracingReportFindFirstMock.mockResolvedValue(baseReport);
    canAccessMock.mockResolvedValue(false);

    await expect(
      getTracingReportRecord('org_1', 'tracing_1', {
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

  it('rejects reports linked to a mismatched issue', async () => {
    tracingReportFindFirstMock.mockResolvedValue({
      ...baseReport,
      issue: {
        ...baseReport.issue,
        patient_id: 'other_patient',
      },
    });

    await expect(getTracingReportRecord('org_1', 'tracing_1')).rejects.toBeInstanceOf(
      PdfNotFoundError,
    );

    expect(patientFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns the normalized tracing report record for accessible reports', async () => {
    tracingReportFindFirstMock.mockResolvedValue(baseReport);

    await expect(
      getTracingReportRecord('org_1', 'tracing_1', {
        userId: 'pharmacist_1',
        role: 'pharmacist',
      }),
    ).resolves.toMatchObject({
      id: 'tracing_1',
      status: 'draft',
      content: { message: '服薬状況を共有' },
      patient: {
        id: 'patient_1',
        name: '山田 太郎',
      },
      issue: {
        title: '副作用確認',
        description: '眠気あり',
        priority: 'high',
        status: 'open',
      },
    });

    expect(tracingReportFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'tracing_1', org_id: 'org_1' },
      select: expect.objectContaining({
        id: true,
        patient_id: true,
        case_id: true,
        content: true,
      }),
    });
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: {
        id: true,
        name: true,
        birth_date: true,
        gender: true,
      },
    });
  });
});
