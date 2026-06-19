import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PHOS_DISABLE_LEGACY_FILE_API_ENV } from '@/lib/api/legacy-file-api-boundary';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  visitRecordFindFirstMock,
  visitScheduleFindFirstMock,
  careCaseFindFirstMock,
  careReportFindFirstMock,
  assertFileUploadConstraintsMock,
  createPresignedUploadMock,
  FileStorageErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  assertFileUploadConstraintsMock: vi.fn(),
  createPresignedUploadMock: vi.fn(),
  FileStorageErrorMock: class FileStorageError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
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
  FileStorageError: FileStorageErrorMock,
  assertFileUploadConstraints: assertFileUploadConstraintsMock,
  createPresignedUpload: createPresignedUploadMock,
}));

import { POST } from './route';

const originalDisableLegacyFileApi = process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV];

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/files/presigned-upload', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/files/presigned-upload', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{',
  });
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
    assertFileUploadConstraintsMock.mockImplementation(() => undefined);
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      patient_id: 'patient_1',
      schedule: {
        pharmacist_id: 'user_1',
        case_: {
          primary_pharmacist_id: null,
          backup_pharmacist_id: null,
        },
      },
    });
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: null,
      visit_record_id: null,
    });
    createPresignedUploadMock.mockResolvedValue({
      id: 'file_1',
      uploadUrl: 'https://example.com/upload',
      objectKey: 'reports/org_1/report_1/file_1-report.pdf',
      expiresIn: 300,
      headers: { 'Content-Type': 'application/pdf' },
    });
  });

  afterEach(() => {
    if (originalDisableLegacyFileApi === undefined) {
      delete process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV];
    } else {
      process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV] = originalDisableLegacyFileApi;
    }
  });

  it('disables the legacy route in PH-OS production before auth, lookup, or presign', async () => {
    process.env[PHOS_DISABLE_LEGACY_FILE_API_ENV] = '1';

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
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PHOS_LEGACY_FILE_API_DISABLED',
    });
    expect(requireAuthContextMock).not.toHaveBeenCalled();
    expect(assertFileUploadConstraintsMock).not.toHaveBeenCalled();
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
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

  it('rejects report upload presigns when the caller lacks canSendCareReport', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        userId: 'clerk_1',
        orgId: 'org_1',
        role: 'clerk',
      },
    });

    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.exe',
        mime_type: 'application/x-msdownload',
        size_bytes: 999_999_999,
        report_id: 'report_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(assertFileUploadConstraintsMock).not.toHaveBeenCalled();
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('rejects report upload presigns for author-only roles before file constraint validation', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        userId: 'trainee_1',
        orgId: 'org_1',
        role: 'pharmacist_trainee',
      },
    });

    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.exe',
        mime_type: 'application/x-msdownload',
        size_bytes: 999_999_999,
        report_id: 'report_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(assertFileUploadConstraintsMock).not.toHaveBeenCalled();
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('rejects non-object upload payloads before entity lookup or presign', async () => {
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(assertFileUploadConstraintsMock).not.toHaveBeenCalled();
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON upload bodies before validation or presign', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(assertFileUploadConstraintsMock).not.toHaveBeenCalled();
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('rejects blank upload fields before entity lookup or presign', async () => {
    const response = await POST(
      createRequest({
        purpose: 'prescription',
        file_name: '   ',
        mime_type: '   ',
        size_bytes: 1024,
        patient_id: '   ',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        file_name: ['ファイル名は必須です'],
        mime_type: ['MIME タイプは必須です'],
        patient_id: ['処方箋アップロードには patient_id が必要です'],
      },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(assertFileUploadConstraintsMock).not.toHaveBeenCalled();
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('normalizes padded filenames, MIME types, and entity ids before lookup or presign', async () => {
    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: '  report.pdf  ',
        mime_type: '  Application/PDF  ',
        size_bytes: 1024,
        report_id: '  report_1  ',
        patient_id: '   ',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(assertFileUploadConstraintsMock).toHaveBeenCalledWith({
      purpose: 'report',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(careReportFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        visit_record_id: true,
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

  it('rejects report upload presigns for archived patients before storage metadata creation', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
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
    expect(response.status).toBe(409);
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported upload constraints before entity lookup or presign', async () => {
    assertFileUploadConstraintsMock.mockImplementationOnce(() => {
      throw new FileStorageErrorMock(
        'FILE_UPLOAD_INVALID_MIME',
        '許可されていない MIME タイプです',
        400,
      );
    });

    const response = await POST(
      createRequest({
        purpose: 'report',
        file_name: 'report.svg',
        mime_type: 'image/svg+xml',
        size_bytes: 1024,
        report_id: 'report_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'FILE_UPLOAD_INVALID_MIME',
    });
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
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
        patient_id: ['patient_id は処方箋または同意書アップロードでのみ指定できます'],
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

  it('allows visit-photo upload for org-wide roles regardless of visit record assignment', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
      },
    });
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      patient_id: 'patient_1',
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
    expect(response.status).toBe(201);
    expect(createPresignedUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'visit-photo',
        visitRecordId: 'visit_1',
      }),
    );
  });

  it('rejects visit-photo upload presigns for archived patients before storage metadata creation', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
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
    expect(response.status).toBe(409);
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
      select: { id: true, archived_at: true },
    });
    // org-wide ロール(pharmacist)は担当割当チェックをバイパスするため visitSchedule 照会は行われない
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
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

  it('rejects prescription upload presigns for archived patients before storage metadata creation', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
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
    expect(response.status).toBe(409);
    expect(createPresignedUploadMock).not.toHaveBeenCalled();
  });

  it('returns a presigned upload url for consent document files on writable patients', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
      },
    });

    const response = await POST(
      createRequest({
        purpose: 'consent-document',
        file_name: 'consent.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        patient_id: 'patient_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(assertFileUploadConstraintsMock).toHaveBeenCalledWith({
      purpose: 'consent-document',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'org_1',
      },
      select: { id: true, archived_at: true },
    });
    expect(createPresignedUploadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      purpose: 'consent-document',
      fileName: 'consent.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      patientId: 'patient_1',
      visitRecordId: undefined,
      reportId: undefined,
    });
  });

  it('allows prescription upload for org-wide roles without patient assignment', async () => {
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
    expect(response.status).toBe(201);
    // org-wide ロールは担当割当をバイパスするため割当照会は行われない
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(createPresignedUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'prescription',
        patientId: 'patient_1',
      }),
    );
  });

  it('allows prescription upload for org-wide roles bypassing care case assignment', async () => {
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
    // org-wide ロールは担当割当をバイパスするため careCase 照会は行われない
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(createPresignedUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'prescription',
        patientId: 'patient_1',
      }),
    );
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

  it('allows report upload for org-wide roles regardless of report case assignment', async () => {
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
    expect(response.status).toBe(201);
    // org-wide ロールは担当割当をバイパスするため report の case 照会は行われない
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(createPresignedUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'report',
        reportId: 'report_1',
      }),
    );
  });

  it('allows report upload for org-wide roles bypassing report care case assignment', async () => {
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
    // org-wide ロールは担当割当をバイパスするため report の case 照会は行われない
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
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
