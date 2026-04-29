import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  visitRecordFindFirstMock,
  visitScheduleFindFirstMock,
  careCaseFindFirstMock,
  careReportFindFirstMock,
  createPresignedUploadMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  createPresignedUploadMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    careReport: {
      findFirst: careReportFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/file-storage', () => ({
  FileStorageError: class FileStorageError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  createPresignedUpload: createPresignedUploadMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' })[key] ?? null,
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/files/presigned-upload POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    visitScheduleFindFirstMock.mockResolvedValue({ id: 'schedule_1' });
    careCaseFindFirstMock.mockResolvedValue(null);
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      schedule: {
        pharmacist_id: 'user_1',
        case_: {
          primary_pharmacist_id: null,
          backup_pharmacist_id: null,
        },
      },
    });
    careReportFindFirstMock.mockResolvedValue({ id: 'report_1' });
    createPresignedUploadMock.mockResolvedValue({
      id: 'file_1',
      uploadUrl: 'https://example.com/upload',
      objectKey: 'reports/org_1/report_1/file_1-report.pdf',
      expiresIn: 300,
      headers: { 'Content-Type': 'application/pdf' },
    });
  });

  it('returns 400 when required entity ids are missing for the purpose', async () => {
    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects entity ids that do not belong to the selected purpose', async () => {
    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        report_id: 'report_1',
        patient_id: 'patient_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        patient_id: ['patient_id は処方箋アップロードでのみ指定できます'],
      },
    });
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the role lacks permission for the purpose', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'clerk',
      },
    });

    const response = await POST(
      createRequest({
        purpose: 'prescription',
        file_name: 'prescription.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        patient_id: 'patient_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the referenced report does not exist', async () => {
    careReportFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        report_id: 'report_missing',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('returns 403 when the caller cannot access the visit record assignment', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
      },
    });
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      schedule: {
        pharmacist_id: 'other_user',
        case_: {
          primary_pharmacist_id: 'primary_user',
          backup_pharmacist_id: 'backup_user',
        },
      },
    });

    const response = await POST(
      createRequest({
        purpose: 'visit-photo',
        file_name: 'visit-photo.png',
        mime_type: 'image/png',
        size_bytes: 1024,
        visit_record_id: 'visit_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('returns a presigned upload url when the prescription patient is accessible', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
      },
    });

    const response = await POST(
      createRequest({
        purpose: 'prescription',
        file_name: 'prescription.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        patient_id: 'patient_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_: {
          patient_id: 'patient_1',
        },
        OR: [
          { pharmacist_id: 'user_1' },
          { case_: { primary_pharmacist_id: 'user_1' } },
          { case_: { backup_pharmacist_id: 'user_1' } },
        ],
      },
      select: { id: true },
    });
    expect(createPresignedUploadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      purpose: 'prescription',
      fileName: 'prescription.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      patientId: 'patient_1',
      visitRecordId: undefined,
      reportId: undefined,
    });
  });

  it('returns 403 when the caller cannot access the prescription patient assignment', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
      },
    });
    visitScheduleFindFirstMock.mockResolvedValue(null);
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        purpose: 'prescription',
        file_name: 'prescription.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        patient_id: 'patient_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('allows prescription upload when the caller is assigned through the care case', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
      },
    });
    visitScheduleFindFirstMock.mockResolvedValue(null);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });

    const response = await POST(
      createRequest({
        purpose: 'prescription',
        file_name: 'prescription.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        patient_id: 'patient_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        OR: [{ primary_pharmacist_id: 'user_1' }, { backup_pharmacist_id: 'user_1' }],
      },
      select: { id: true },
    });
  });

  it('allows admin prescription upload without patient assignment checks', async () => {
    const response = await POST(
      createRequest({
        purpose: 'prescription',
        file_name: 'prescription.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        patient_id: 'patient_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns a presigned upload url when references are valid', async () => {
    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        report_id: 'report_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(createPresignedUploadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      purpose: 'report',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      patientId: undefined,
      visitRecordId: undefined,
      reportId: 'report_1',
    });
  });

  it('returns 403 when the caller cannot access the report assignment', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
      },
    });
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: null,
    });
    careCaseFindFirstMock.mockResolvedValue({
      primary_pharmacist_id: 'other_user',
      backup_pharmacist_id: null,
    });

    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        report_id: 'report_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('allows report upload when the caller is assigned through the report care case', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
      },
    });
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: null,
    });
    careCaseFindFirstMock.mockResolvedValue({
      primary_pharmacist_id: null,
      backup_pharmacist_id: 'user_1',
    });

    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        report_id: 'report_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
      },
      select: {
        primary_pharmacist_id: true,
        backup_pharmacist_id: true,
      },
    });
    expect(createPresignedUploadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      purpose: 'report',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      patientId: undefined,
      visitRecordId: undefined,
      reportId: 'report_1',
    });
  });
});
