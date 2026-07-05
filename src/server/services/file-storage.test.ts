import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectPhiExportSnapshotRedacted } from '@/test/api-response-assertions';

const {
  getSignedUrlMock,
  settingUpsertMock,
  settingFindFirstMock,
  settingFindManyMock,
  settingUpdateMock,
  settingDeleteManyMock,
  patientFindFirstMock,
  visitScheduleFindFirstMock,
  careCaseFindFirstMock,
  visitRecordFindFirstMock,
  careReportFindFirstMock,
  careReportUpdateManyMock,
  contractDocumentFindFirstMock,
  fileAssetFindFirstMock,
  fileAssetFindManyMock,
  fileAssetUpsertMock,
  fileAssetUpdateMock,
  fileAssetDeleteManyMock,
  randomUuidMock,
  s3ClientMock,
  s3SendMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  getSignedUrlMock: vi.fn(),
  settingUpsertMock: vi.fn(),
  settingFindFirstMock: vi.fn(),
  settingFindManyMock: vi.fn(),
  settingUpdateMock: vi.fn(),
  settingDeleteManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  careReportUpdateManyMock: vi.fn(),
  contractDocumentFindFirstMock: vi.fn(),
  fileAssetFindFirstMock: vi.fn(),
  fileAssetFindManyMock: vi.fn(),
  fileAssetUpsertMock: vi.fn(),
  fileAssetUpdateMock: vi.fn(),
  fileAssetDeleteManyMock: vi.fn(),
  randomUuidMock: vi.fn(),
  s3ClientMock: vi.fn(),
  s3SendMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { warn: loggerWarnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('node:crypto', () => ({
  default: {
    randomUUID: randomUuidMock,
  },
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class S3Client {
    send = s3SendMock;

    constructor(config: unknown) {
      s3ClientMock(config);
    }
  },
  PutObjectCommand: class PutObjectCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  DeleteObjectCommand: class DeleteObjectCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  GetObjectCommand: class GetObjectCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  HeadObjectCommand: class HeadObjectCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    setting: {
      upsert: settingUpsertMock,
      findFirst: settingFindFirstMock,
      findMany: settingFindManyMock,
      update: settingUpdateMock,
      deleteMany: settingDeleteManyMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
    careReport: {
      findFirst: careReportFindFirstMock,
      updateMany: careReportUpdateManyMock,
    },
    contractDocument: {
      findFirst: contractDocumentFindFirstMock,
    },
    fileAsset: {
      findFirst: fileAssetFindFirstMock,
      findMany: fileAssetFindManyMock,
      upsert: fileAssetUpsertMock,
      update: fileAssetUpdateMock,
      deleteMany: fileAssetDeleteManyMock,
    },
  },
}));

import {
  completeUploadedFile,
  cleanupExpiredGeneratedFiles,
  createPresignedDownload,
  createPresignedUpload,
  deleteGeneratedFile,
  storeGeneratedFile,
  type StoredFileRecord,
} from './file-storage';

const assignedAccessContext = {
  userId: 'user_1',
  role: 'pharmacist' as const,
};

const unassignedAccessContext = {
  userId: 'user_unassigned',
  role: 'pharmacist' as const,
};

function buildStoredFileRecord(overrides: Partial<StoredFileRecord> = {}): StoredFileRecord {
  return {
    version: 1,
    id: 'file_1',
    orgId: 'org_1',
    purpose: 'visit-photo',
    storageKey: 'visit-photos/org_1/visit_1/file_1-note.pdf',
    originalName: 'note.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    status: 'uploaded',
    patientId: null,
    visitRecordId: 'visit_1',
    reportId: null,
    jobId: null,
    uploadedBy: null,
    etag: null,
    createdAt: '2026-03-28T00:00:00.000Z',
    updatedAt: '2026-03-28T00:00:00.000Z',
    completedAt: '2026-03-28T00:00:00.000Z',
    downloadDisposition: 'inline',
    ...overrides,
  } satisfies StoredFileRecord;
}

function mockStoredFile(overrides: Record<string, unknown> = {}) {
  settingFindFirstMock.mockResolvedValue({
    id: 'setting_1',
    value: buildStoredFileRecord(overrides),
  });
}

function mockVisitRecordAssignment(userId: string) {
  visitRecordFindFirstMock.mockResolvedValue({
    id: 'visit_1',
    patient_id: 'patient_1',
    schedule: {
      pharmacist_id: userId,
      case_: {
        primary_pharmacist_id: 'primary_user',
        backup_pharmacist_id: null,
      },
    },
  });
}

function mockReportLinkedToVisitRecord() {
  careReportFindFirstMock.mockResolvedValue({
    id: 'report_1',
    patient_id: 'patient_1',
    case_id: null,
    visit_record_id: 'visit_1',
  });
}

type AccessCase = {
  purpose: 'visit-photo' | 'prescription' | 'report' | 'consent-document';
  record: Record<string, unknown>;
  authorize: () => void;
  deny: () => void;
};

const fileAccessCases: AccessCase[] = [
  {
    purpose: 'visit-photo',
    record: {
      purpose: 'visit-photo',
      visitRecordId: 'visit_1',
      patientId: null,
      reportId: null,
      storageKey: 'visit-photos/org_1/visit_1/file_1-note.pdf',
    },
    authorize: () => mockVisitRecordAssignment('user_1'),
    deny: () => mockVisitRecordAssignment('other_user'),
  },
  {
    purpose: 'prescription',
    record: {
      purpose: 'prescription',
      patientId: 'patient_1',
      visitRecordId: null,
      reportId: null,
      storageKey: 'prescriptions/org_1/patient_1/file_1-prescription.pdf',
      originalName: 'prescription.pdf',
    },
    authorize: () => {
      patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
      visitScheduleFindFirstMock.mockResolvedValue({ id: 'schedule_1' });
      careCaseFindFirstMock.mockResolvedValue(null);
    },
    deny: () => {
      patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
      visitScheduleFindFirstMock.mockResolvedValue(null);
      careCaseFindFirstMock.mockResolvedValue(null);
    },
  },
  {
    purpose: 'consent-document',
    record: {
      purpose: 'consent-document',
      patientId: 'patient_1',
      visitRecordId: null,
      reportId: null,
      storageKey: 'consent-documents/org_1/patient_1/file_1-consent.pdf',
      originalName: 'consent.pdf',
    },
    authorize: () => {
      patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
      visitScheduleFindFirstMock.mockResolvedValue({ id: 'schedule_1' });
      careCaseFindFirstMock.mockResolvedValue(null);
    },
    deny: () => {
      patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
      visitScheduleFindFirstMock.mockResolvedValue(null);
      careCaseFindFirstMock.mockResolvedValue(null);
    },
  },
  {
    purpose: 'report',
    record: {
      purpose: 'report',
      reportId: 'report_1',
      patientId: null,
      visitRecordId: null,
      storageKey: 'reports/org_1/report_1/file_1-report.pdf',
      originalName: 'report.pdf',
    },
    authorize: () => {
      mockReportLinkedToVisitRecord();
      mockVisitRecordAssignment('user_1');
    },
    deny: () => {
      mockReportLinkedToVisitRecord();
      mockVisitRecordAssignment('other_user');
    },
  },
];

describe('file-storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = 'ph-os-files';
    process.env.S3_BUCKET_REGION = 'ap-northeast-1';
    delete process.env.S3_SERVER_SIDE_ENCRYPTION;
    delete process.env.S3_KMS_KEY_ID;
    delete process.env.S3_KMS_KEY_ID_PHI;
    delete process.env.S3_KMS_KEY_ID_REPORT;
    delete process.env.S3_KMS_KEY_ID_EXPORT;
    delete process.env.BULK_EXPORT_FILE_RETENTION_HOURS;
    randomUuidMock.mockReturnValue('file-uuid-1');
    getSignedUrlMock.mockResolvedValue('https://example.com/upload');
    settingUpsertMock.mockResolvedValue(undefined);
    settingFindFirstMock.mockResolvedValue(null);
    settingFindManyMock.mockResolvedValue([]);
    settingUpdateMock.mockResolvedValue(undefined);
    settingDeleteManyMock.mockResolvedValue({ count: 1 });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    visitScheduleFindFirstMock.mockResolvedValue({ id: 'schedule_1' });
    careCaseFindFirstMock.mockResolvedValue(null);
    mockVisitRecordAssignment('user_1');
    mockReportLinkedToVisitRecord();
    careReportUpdateManyMock.mockResolvedValue({ count: 1 });
    contractDocumentFindFirstMock.mockResolvedValue(null);
    fileAssetFindFirstMock.mockResolvedValue(null);
    fileAssetFindManyMock.mockResolvedValue([]);
    fileAssetUpsertMock.mockResolvedValue({});
    fileAssetUpdateMock.mockResolvedValue({});
    fileAssetDeleteManyMock.mockResolvedValue({ count: 1 });
    s3SendMock.mockResolvedValue({
      ETag: '"etag-123"',
      ContentLength: 2048,
      ContentType: 'application/pdf',
    });
  });

  it('signs uploads with AES256 server-side encryption and returns the required header', async () => {
    const result = await createPresignedUpload({
      orgId: 'org_1',
      purpose: 'report',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      reportId: 'report_1',
    });

    expect(getSignedUrlMock).toHaveBeenCalledOnce();
    expect(s3ClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    const putObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(putObjectCommand.input).toMatchObject({
      Bucket: 'ph-os-files',
      Key: 'reports/org_1/report_1/file-uuid-1-report.pdf',
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
    });

    expect(result.headers).toEqual({
      'Content-Type': 'application/pdf',
      'x-amz-server-side-encryption': 'AES256',
    });
  });

  it('creates a separate S3 client when the configured bucket region changes', async () => {
    process.env.S3_BUCKET_REGION = 'eu-central-1';
    await createPresignedUpload({
      orgId: 'org_1',
      purpose: 'report',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      reportId: 'report_1',
    });
    process.env.S3_BUCKET_REGION = 'ca-central-1';
    randomUuidMock.mockReturnValueOnce('file-uuid-2');

    await createPresignedUpload({
      orgId: 'org_1',
      purpose: 'report',
      fileName: 'report-2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      reportId: 'report_1',
    });

    expect(s3ClientMock).toHaveBeenCalledTimes(2);
    expect(s3ClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(s3ClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
  });

  it('rejects unsupported MIME types before signing uploads or writing metadata', async () => {
    await expect(
      createPresignedUpload({
        orgId: 'org_1',
        purpose: 'prescription',
        fileName: 'payload.svg',
        mimeType: 'image/svg+xml',
        sizeBytes: 1024,
        patientId: 'patient_1',
      }),
    ).rejects.toMatchObject({
      code: 'FILE_UPLOAD_INVALID_MIME',
      status: 400,
    });

    expect(randomUuidMock).not.toHaveBeenCalled();
    expect(getSignedUrlMock).not.toHaveBeenCalled();
    expect(settingUpsertMock).not.toHaveBeenCalled();
  });

  it('stores consent-document uploads under patient-scoped consent document keys', async () => {
    const result = await createPresignedUpload({
      orgId: 'org_1',
      purpose: 'consent-document',
      fileName: 'consent.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      patientId: 'patient_1',
    });

    expect(getSignedUrlMock).toHaveBeenCalledOnce();
    const putObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(putObjectCommand.input).toMatchObject({
      Bucket: 'ph-os-files',
      Key: 'consent-documents/org_1/patient_1/file-uuid-1-consent.pdf',
      ContentType: 'application/pdf',
    });
    expect(result.objectKey).toBe('consent-documents/org_1/patient_1/file-uuid-1-consent.pdf');
  });

  it.each([
    ['prescription', { patientId: undefined, visitRecordId: undefined, reportId: undefined }],
    ['consent-document', { patientId: undefined, visitRecordId: undefined, reportId: undefined }],
    ['visit-photo', { patientId: undefined, visitRecordId: undefined, reportId: undefined }],
    ['report', { patientId: undefined, visitRecordId: undefined, reportId: undefined }],
  ] as const)(
    'rejects %s uploads without the required domain reference before signing',
    async (purpose, references) => {
      await expect(
        createPresignedUpload({
          orgId: 'org_1',
          purpose,
          fileName: 'clinical.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          ...references,
        }),
      ).rejects.toMatchObject({
        code: 'FILE_UPLOAD_REFERENCE_MISSING',
        status: 400,
      });

      expect(randomUuidMock).not.toHaveBeenCalled();
      expect(getSignedUrlMock).not.toHaveBeenCalled();
      expect(settingUpsertMock).not.toHaveBeenCalled();
    },
  );

  it('sanitizes path-like filenames before using them in storage keys and metadata', async () => {
    const result = await createPresignedUpload({
      orgId: 'org_1',
      purpose: 'report',
      fileName: '../../退避/clinical report?.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      reportId: 'report_1',
    });

    const putObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(putObjectCommand.input.Key).toBe(
      'reports/org_1/report_1/file-uuid-1-.._..____clinical_report_.pdf',
    );
    expect(putObjectCommand.input.Key).not.toContain('../');
    expect(putObjectCommand.input.Key).not.toContain('clinical report');
    expect(result.objectKey).toBe(
      'reports/org_1/report_1/file-uuid-1-.._..____clinical_report_.pdf',
    );
    expect(settingUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          value: expect.objectContaining({
            originalName: '.._..____clinical_report_.pdf',
          }),
        }),
      }),
    );
  });

  it('stores generated zip files under the bulk export path', async () => {
    const result = await storeGeneratedFile({
      orgId: 'org_1',
      purpose: 'bulk-export',
      fileName: 'medication-history.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('zip-bytes'),
      uploadedBy: 'user_1',
      jobId: 'job_1',
    });

    expect(s3SendMock).toHaveBeenCalledOnce();
    expect(s3SendMock).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
    const putObjectCommand = s3SendMock.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(putObjectCommand.input).toMatchObject({
      Bucket: 'ph-os-files',
      Key: 'bulk-exports/org_1/job_1/file-uuid-1-medication-history.zip',
      ContentType: 'application/zip',
      ServerSideEncryption: 'AES256',
    });

    expect(settingUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          value: expect.objectContaining({
            purpose: 'bulk-export',
            status: 'uploaded',
            jobId: 'job_1',
            uploadedBy: 'user_1',
            expiresAt: expect.any(String),
          }),
        }),
      }),
    );
    expect(result.storageKey).toBe('bulk-exports/org_1/job_1/file-uuid-1-medication-history.zip');
  });

  it('stores generated contract document PDFs under the contract document path with retention expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:00:00.000Z'));
    let result!: Awaited<ReturnType<typeof storeGeneratedFile>>;
    try {
      result = await storeGeneratedFile({
        orgId: 'org_1',
        purpose: 'contract-document',
        fileName: 'contract-v1.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('pdf-bytes'),
        uploadedBy: 'user_1',
        jobId: 'contract-document-contract_1',
        downloadDisposition: 'attachment',
      });
    } finally {
      vi.useRealTimers();
    }

    expect(s3SendMock).toHaveBeenCalledOnce();
    const putObjectCommand = s3SendMock.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(putObjectCommand.input).toMatchObject({
      Bucket: 'ph-os-files',
      Key: 'contract-documents/org_1/generated/contract-document-contract_1/file-uuid-1-contract-v1.pdf',
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
    });

    expect(settingUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          value: expect.objectContaining({
            purpose: 'contract-document',
            status: 'uploaded',
            jobId: 'contract-document-contract_1',
            uploadedBy: 'user_1',
            expiresAt: '2033-03-28T00:00:00.000Z',
            downloadDisposition: 'attachment',
          }),
        }),
      }),
    );
    expect(result.storageKey).toBe(
      'contract-documents/org_1/generated/contract-document-contract_1/file-uuid-1-contract-v1.pdf',
    );
  });

  it('cleans up generated contract document PDFs when canonical FileAsset metadata cannot be written', async () => {
    fileAssetUpsertMock.mockRejectedValueOnce(new Error('file asset unavailable'));

    await expect(
      storeGeneratedFile({
        orgId: 'org_1',
        purpose: 'contract-document',
        fileName: 'contract-v1.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('pdf-bytes'),
        uploadedBy: 'user_1',
        jobId: 'contract-document-contract_1',
        downloadDisposition: 'attachment',
      }),
    ).rejects.toMatchObject({
      code: 'FILE_METADATA_WRITE_FAILED',
      status: 502,
    });

    expect(s3SendMock).toHaveBeenCalledTimes(2);
    expect((s3SendMock.mock.calls[1]?.[0] as { input: Record<string, unknown> }).input).toEqual({
      Bucket: 'ph-os-files',
      Key: 'contract-documents/org_1/generated/contract-document-contract_1/file-uuid-1-contract-v1.pdf',
    });
    expect(settingUpsertMock).not.toHaveBeenCalled();
  });

  it('falls back to the default bulk export retention when the configured value is unsafe', async () => {
    process.env.BULK_EXPORT_FILE_RETENTION_HOURS =
      '999999999999999999999999999999999999999999999999999999999999';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:00:00.000Z'));

    try {
      await storeGeneratedFile({
        orgId: 'org_1',
        purpose: 'bulk-export',
        fileName: 'medication-history.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from('zip-bytes'),
        uploadedBy: 'user_1',
        jobId: 'job_1',
      });
    } finally {
      vi.useRealTimers();
    }

    expect(settingUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          value: expect.objectContaining({
            expiresAt: '2026-03-31T00:00:00.000Z',
          }),
        }),
      }),
    );
  });

  it('cleans up the S3 object when generated file metadata cannot be written', async () => {
    settingUpsertMock.mockRejectedValueOnce(new Error('metadata unavailable'));

    await expect(
      storeGeneratedFile({
        orgId: 'org_1',
        purpose: 'bulk-export',
        fileName: 'medication-history.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from('zip-bytes'),
        uploadedBy: 'user_1',
        jobId: 'job_1',
      }),
    ).rejects.toThrow('metadata unavailable');

    expect(s3SendMock).toHaveBeenCalledTimes(2);
    expect((s3SendMock.mock.calls[1]?.[0] as { input: Record<string, unknown> }).input).toEqual({
      Bucket: 'ph-os-files',
      Key: 'bulk-exports/org_1/job_1/file-uuid-1-medication-history.zip',
    });
  });

  it('deletes generated bulk export files and their metadata', async () => {
    const record = buildStoredFileRecord({
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_1/file_1-medication-history.zip',
      jobId: 'job_1',
      uploadedBy: 'user_1',
    });

    await deleteGeneratedFile(record);

    expect(s3SendMock).toHaveBeenCalledOnce();
    expect((s3SendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input).toEqual({
      Bucket: 'ph-os-files',
      Key: 'bulk-exports/org_1/job_1/file_1-medication-history.zip',
    });
    expect(settingDeleteManyMock).toHaveBeenCalledWith({
      where: {
        scope: 'organization',
        scope_id: 'org_1',
        key: 'file_asset:file_1',
      },
    });
  });

  it('does not delete non-generated bulk export files through the generated cleanup path', async () => {
    await expect(deleteGeneratedFile(buildStoredFileRecord())).rejects.toMatchObject({
      code: 'FILE_DELETE_FORBIDDEN',
      status: 403,
    });
    expect(s3SendMock).not.toHaveBeenCalled();
    expect(settingDeleteManyMock).not.toHaveBeenCalled();
  });

  it('does not delete linked contract document files through the generated cleanup path', async () => {
    contractDocumentFindFirstMock.mockResolvedValue({ id: 'contract_document_1' });

    await expect(
      deleteGeneratedFile(
        buildStoredFileRecord({
          purpose: 'contract-document',
          storageKey:
            'contract-documents/org_1/generated/contract-document-contract_1/file_1-contract-v1.pdf',
          jobId: 'contract-document-contract_1',
          downloadDisposition: 'attachment',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'FILE_DELETE_FORBIDDEN',
      status: 403,
    });
    expect(contractDocumentFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        file_id: 'file_1',
      },
      select: { id: true },
    });
    expect(s3SendMock).not.toHaveBeenCalled();
    expect(settingDeleteManyMock).not.toHaveBeenCalled();
  });

  it.each([
    ['array metadata', []],
    ['unsupported purpose', { ...buildStoredFileRecord(), purpose: 'unknown-purpose' }],
    ['unsupported status', { ...buildStoredFileRecord(), status: 'deleted' }],
    ['non-finite file size', { ...buildStoredFileRecord(), sizeBytes: Number.NaN }],
    [
      'storage key outside the recorded purpose scope',
      {
        ...buildStoredFileRecord({
          purpose: 'report',
          reportId: 'report_1',
          storageKey: 'prescriptions/org_1/patient_1/file_1-report.pdf',
        }),
      },
    ],
  ])('rejects malformed stored metadata before S3 access: %s', async (_caseName, value) => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value,
    });

    await expect(
      createPresignedDownload({
        orgId: 'org_1',
        fileId: 'file_1',
        accessContext: assignedAccessContext,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_METADATA_NOT_FOUND',
      status: 404,
    });
    expect(getSignedUrlMock).not.toHaveBeenCalled();
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it('uses PHI-safe delivery filenames instead of stored original filenames', async () => {
    mockStoredFile({
      purpose: 'report',
      reportId: 'report_1',
      storageKey: 'reports/org_1/report_1/file_1-report.pdf',
      originalName:
        'Taro Yamada 090-1234-5678 アムロジピン storageKey=s3 token=secret provider raw error.pdf',
      status: 'uploaded',
    });

    const result = await createPresignedDownload({
      orgId: 'org_1',
      fileId: 'file_1',
      accessContext: assignedAccessContext,
    });

    expect(result.fileName).toBe('report-file-file_1.pdf');
    expectPhiExportSnapshotRedacted(result.fileName, ['Taro', 'Yamada']);
    const getObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(getObjectCommand.input).toMatchObject({
      ResponseContentDisposition: 'inline; filename="report-file-file_1.pdf"',
    });
    expectPhiExportSnapshotRedacted(String(getObjectCommand.input.ResponseContentDisposition), [
      'Taro',
      'Yamada',
    ]);
  });

  it('rejects expired generated bulk export downloads before signing', async () => {
    mockStoredFile({
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_1/file_1-medication-history.zip',
      jobId: 'job_1',
      uploadedBy: 'user_1',
      downloadDisposition: 'attachment',
      expiresAt: '2026-03-27T23:59:59.000Z',
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:00:00.000Z'));

    await expect(
      createPresignedDownload({
        orgId: 'org_1',
        fileId: 'file_1',
        accessContext: assignedAccessContext,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_EXPIRED',
      status: 410,
    });
    expect(getSignedUrlMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('allows generated bulk export downloads before expiry', async () => {
    mockStoredFile({
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_1/file_1-medication-history.zip',
      jobId: 'job_1',
      uploadedBy: 'user_1',
      downloadDisposition: 'attachment',
      expiresAt: '2026-03-28T00:00:01.000Z',
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:00:00.000Z'));

    const result = await createPresignedDownload({
      orgId: 'org_1',
      fileId: 'file_1',
      accessContext: assignedAccessContext,
    });

    expect(result.downloadUrl).toBe('https://example.com/upload');
    expect(getSignedUrlMock).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('cleans up expired generated bulk export files and skips unexpired artifacts', async () => {
    const expiredRecord = buildStoredFileRecord({
      id: 'expired_file',
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_1/expired_file-medication-history.zip',
      jobId: 'job_1',
      expiresAt: '2026-03-27T23:59:59.000Z',
    });
    const activeRecord = buildStoredFileRecord({
      id: 'active_file',
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_2/active_file-medication-history.zip',
      jobId: 'job_2',
      expiresAt: '2026-03-28T00:00:01.000Z',
    });
    const prescriptionRecord = buildStoredFileRecord({
      id: 'prescription_file',
      purpose: 'prescription',
      storageKey: 'prescriptions/org_1/patient_1/prescription_file.pdf',
      patientId: 'patient_1',
      visitRecordId: null,
    });
    settingFindManyMock.mockResolvedValue([
      { value: expiredRecord },
      { value: activeRecord },
      { value: prescriptionRecord },
    ]);

    const result = await cleanupExpiredGeneratedFiles({
      orgId: 'org_1',
      now: new Date('2026-03-28T00:00:00.000Z'),
    });

    expect(result).toEqual({ processedCount: 1, scannedCount: 3, errors: [] });
    expect(settingFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scope: 'organization',
          scope_id: 'org_1',
          key: { startsWith: 'file_asset:' },
        }),
      }),
    );
    expect(s3SendMock).toHaveBeenCalledOnce();
    expect((s3SendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input).toEqual({
      Bucket: 'ph-os-files',
      Key: 'bulk-exports/org_1/job_1/expired_file-medication-history.zip',
    });
    expect(settingDeleteManyMock).toHaveBeenCalledWith({
      where: {
        scope: 'organization',
        scope_id: 'org_1',
        key: 'file_asset:expired_file',
      },
    });
  });

  it('records sanitized partial failures when an expired file deletion fails', async () => {
    const expiredRecord = buildStoredFileRecord({
      id: 'expired_file',
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_1/expired_file-medication-history.zip',
      jobId: 'job_1',
      expiresAt: '2026-03-27T23:59:59.000Z',
    });
    settingFindManyMock.mockResolvedValue([{ value: expiredRecord }]);
    s3SendMock.mockRejectedValueOnce(
      new Error('s3 delete failed patient=患者A token=secret storageKey=bulk-exports/org_1/raw'),
    );

    const result = await cleanupExpiredGeneratedFiles({
      orgId: 'org_1',
      now: new Date('2026-03-28T00:00:00.000Z'),
    });

    // 失敗が握り潰されず errors に積まれ、呼び出し側の検査有無に依らず warn で観測できる
    expect(result.processedCount).toBe(0);
    expect(result.errors).toEqual(['保持期限切れファイルの削除に失敗しました']);
    expect(result.errors.join(' ')).not.toContain('患者A');
    expect(result.errors.join(' ')).not.toContain('secret');
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'expired generated file cleanup completed with deletion failures',
      expect.objectContaining({
        event: 'file_storage.expired_cleanup_partial_failure',
        failed_count: 1,
        orgId: 'org_1',
      }),
    );
  });

  it('continues scanning later pages for expired generated bulk export files', async () => {
    const activeRecord = buildStoredFileRecord({
      id: 'active_file',
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_1/active_file-medication-history.zip',
      jobId: 'job_1',
      expiresAt: '2026-03-28T00:00:01.000Z',
    });
    const expiredRecord = buildStoredFileRecord({
      id: 'expired_file',
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_2/expired_file-medication-history.zip',
      jobId: 'job_2',
      expiresAt: '2026-03-27T23:59:59.000Z',
    });
    settingFindManyMock
      .mockResolvedValueOnce([{ id: 'setting_1', value: activeRecord }])
      .mockResolvedValueOnce([{ id: 'setting_2', value: expiredRecord }])
      .mockResolvedValueOnce([]);

    const result = await cleanupExpiredGeneratedFiles({
      now: new Date('2026-03-28T00:00:00.000Z'),
      batchSize: 1,
      maxPages: 3,
    });

    expect(result).toEqual({ processedCount: 1, scannedCount: 2, errors: [] });
    expect(settingFindManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: { id: 'setting_1' },
        skip: 1,
      }),
    );
    expect(settingDeleteManyMock).toHaveBeenCalledWith({
      where: {
        scope: 'organization',
        scope_id: 'org_1',
        key: 'file_asset:expired_file',
      },
    });
  });

  it('uses the default cleanup batch size when the supplied batch size is non-finite', async () => {
    settingFindManyMock.mockResolvedValueOnce([]);

    const result = await cleanupExpiredGeneratedFiles({
      batchSize: Number.NaN,
      maxPages: 1,
    });

    expect(result).toEqual({ processedCount: 0, scannedCount: 0, errors: [] });
    expect(settingFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it('uses the default cleanup max pages when the supplied max pages value is non-finite', async () => {
    const activeRecord = buildStoredFileRecord({
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_1/active_file-medication-history.zip',
      jobId: 'job_1',
      expiresAt: '2026-03-28T00:00:01.000Z',
    });
    for (let page = 0; page < 10; page += 1) {
      settingFindManyMock.mockResolvedValueOnce([
        { id: `setting_${page}`, value: { ...activeRecord, id: `active_file_${page}` } },
      ]);
    }
    settingFindManyMock.mockResolvedValue([]);

    const result = await cleanupExpiredGeneratedFiles({
      now: new Date('2026-03-28T00:00:00.000Z'),
      batchSize: 1,
      maxPages: Number.POSITIVE_INFINITY,
    });

    expect(result).toEqual({ processedCount: 0, scannedCount: 10, errors: [] });
    expect(settingFindManyMock).toHaveBeenCalledTimes(10);
    expect(s3SendMock).not.toHaveBeenCalled();
    expect(settingDeleteManyMock).not.toHaveBeenCalled();
  });

  it('still scans generated files when the supplied max pages value is NaN', async () => {
    const expiredRecord = buildStoredFileRecord({
      id: 'expired_file',
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_1/expired_file-medication-history.zip',
      jobId: 'job_1',
      expiresAt: '2026-03-27T23:59:59.000Z',
    });
    settingFindManyMock
      .mockResolvedValueOnce([{ id: 'setting_1', value: expiredRecord }])
      .mockResolvedValueOnce([]);

    const result = await cleanupExpiredGeneratedFiles({
      now: new Date('2026-03-28T00:00:00.000Z'),
      batchSize: 1,
      maxPages: Number.NaN,
    });

    expect(result).toEqual({ processedCount: 1, scannedCount: 1, errors: [] });
    expect(settingFindManyMock).toHaveBeenCalledTimes(2);
    expect(settingDeleteManyMock).toHaveBeenCalledWith({
      where: {
        scope: 'organization',
        scope_id: 'org_1',
        key: 'file_asset:expired_file',
      },
    });
  });

  it('uses KMS encryption when the bucket is configured for aws:kms', async () => {
    process.env.S3_SERVER_SIDE_ENCRYPTION = 'aws:kms';
    process.env.S3_KMS_KEY_ID_PHI = 'arn:aws:kms:ap-northeast-1:123456789012:key/phi';

    const result = await createPresignedUpload({
      orgId: 'org_1',
      purpose: 'prescription',
      fileName: 'prescription.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      patientId: 'patient_1',
    });

    const putObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(putObjectCommand.input).toMatchObject({
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'arn:aws:kms:ap-northeast-1:123456789012:key/phi',
    });
    expect(result.headers).toMatchObject({
      'x-amz-server-side-encryption': 'aws:kms',
      'x-amz-server-side-encryption-aws-kms-key-id':
        'arn:aws:kms:ap-northeast-1:123456789012:key/phi',
    });
  });

  it('adds five-year Object Lock headers for prescription uploads', async () => {
    const result = await createPresignedUpload({
      orgId: 'org_1',
      purpose: 'prescription',
      fileName: 'prescription.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      patientId: 'patient_1',
    });

    const putObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(putObjectCommand.input).toMatchObject({
      Bucket: 'ph-os-files',
      Key: 'prescriptions/org_1/patient_1/file-uuid-1-prescription.pdf',
      ObjectLockMode: 'COMPLIANCE',
    });
    expect(putObjectCommand.input.ObjectLockRetainUntilDate).toBeInstanceOf(Date);
    expect(result.headers['x-amz-object-lock-mode']).toBe('COMPLIANCE');
    expect(result.headers['x-amz-object-lock-retain-until-date']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('allows PDF attachments for visit records up to the document size limit', async () => {
    const result = await createPresignedUpload({
      orgId: 'org_1',
      purpose: 'visit-photo',
      fileName: 'visit-note.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 20 * 1024 * 1024,
      visitRecordId: 'visit_1',
    });

    const putObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(putObjectCommand.input).toMatchObject({
      Bucket: 'ph-os-files',
      Key: 'visit-photos/org_1/visit_1/file-uuid-1-visit-note.pdf',
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
    });

    expect(result.headers).toEqual({
      'Content-Type': 'application/pdf',
      'x-amz-server-side-encryption': 'AES256',
    });
  });

  it('signs contract document PDF uploads under the uploaded contract document path', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:00:00.000Z'));
    let result!: Awaited<ReturnType<typeof createPresignedUpload>>;
    try {
      result = await createPresignedUpload({
        orgId: 'org_1',
        purpose: 'contract-document',
        fileName: 'signed-contract.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      });
    } finally {
      vi.useRealTimers();
    }

    const putObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(putObjectCommand.input).toMatchObject({
      Bucket: 'ph-os-files',
      Key: 'contract-documents/org_1/uploaded/file-uuid-1-signed-contract.pdf',
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
    });
    expect(settingUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          value: expect.objectContaining({
            purpose: 'contract-document',
            status: 'pending_upload',
            patientId: null,
            reportId: null,
            jobId: null,
            expiresAt: '2033-03-28T00:00:00.000Z',
            downloadDisposition: 'attachment',
          }),
        }),
      }),
    );
    expect(result.objectKey).toBe(
      'contract-documents/org_1/uploaded/file-uuid-1-signed-contract.pdf',
    );
  });

  it('rejects non-PDF contract document uploads', async () => {
    await expect(
      createPresignedUpload({
        orgId: 'org_1',
        purpose: 'contract-document',
        fileName: 'signed-contract.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_UPLOAD_INVALID_MIME',
      status: 400,
    });

    expect(getSignedUrlMock).not.toHaveBeenCalled();
    expect(settingUpsertMock).not.toHaveBeenCalled();
    expect(fileAssetUpsertMock).not.toHaveBeenCalled();
  });

  it('signs generated zip downloads as attachments', async () => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        id: 'file_1',
        orgId: 'org_1',
        purpose: 'bulk-export',
        storageKey: 'bulk-exports/org_1/job_1/file_1-medication-history.zip',
        originalName: 'medication-history.zip',
        mimeType: 'application/zip',
        sizeBytes: 2048,
        status: 'uploaded',
        uploadedBy: 'user_1',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: '2026-03-28T00:00:00.000Z',
        downloadDisposition: 'attachment',
      },
    });

    await createPresignedDownload({
      orgId: 'org_1',
      fileId: 'file_1',
      accessContext: assignedAccessContext,
    });

    const getObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(getObjectCommand.input).toMatchObject({
      ResponseContentDisposition: 'attachment; filename="bulk-export-file_1.zip"',
    });
  });

  it('allows org-wide roles to download bulk exports requested by another user', async () => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        id: 'file_1',
        orgId: 'org_1',
        purpose: 'bulk-export',
        storageKey: 'bulk-exports/org_1/job_1/file_1-medication-history.zip',
        originalName: 'medication-history.zip',
        mimeType: 'application/zip',
        sizeBytes: 2048,
        status: 'uploaded',
        uploadedBy: 'user_1',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: '2026-03-28T00:00:00.000Z',
        downloadDisposition: 'attachment',
      },
    });

    const result = await createPresignedDownload({
      orgId: 'org_1',
      fileId: 'file_1',
      accessContext: {
        userId: 'user_2',
        role: 'pharmacist',
      },
    });

    expect(result.downloadUrl).toBe('https://example.com/upload');
    expect(getSignedUrlMock).toHaveBeenCalledOnce();
  });

  it('allows admins to download bulk exports requested by another user', async () => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        id: 'file_1',
        orgId: 'org_1',
        purpose: 'bulk-export',
        storageKey: 'bulk-exports/org_1/job_1/file_1-medication-history.zip',
        originalName: 'medication-history.zip',
        mimeType: 'application/zip',
        sizeBytes: 2048,
        status: 'uploaded',
        uploadedBy: 'user_1',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: '2026-03-28T00:00:00.000Z',
        downloadDisposition: 'attachment',
      },
    });

    const result = await createPresignedDownload({
      orgId: 'org_1',
      fileId: 'file_1',
      accessContext: {
        userId: 'admin_1',
        role: 'admin',
      },
    });

    expect(result.downloadUrl).toBe('https://example.com/upload');
  });

  it('rejects bulk export downloads when the caller lacks canVisit', async () => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        id: 'file_1',
        orgId: 'org_1',
        purpose: 'bulk-export',
        storageKey: 'bulk-exports/org_1/job_1/file_1-medication-history.zip',
        originalName: 'medication-history.zip',
        mimeType: 'application/zip',
        sizeBytes: 2048,
        status: 'uploaded',
        uploadedBy: 'user_1',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: '2026-03-28T00:00:00.000Z',
        downloadDisposition: 'attachment',
      },
    });

    await expect(
      createPresignedDownload({
        orgId: 'org_1',
        fileId: 'file_1',
        accessContext: {
          userId: 'clerk_1',
          role: 'clerk',
        },
      }),
    ).rejects.toMatchObject({
      code: 'FILE_DOWNLOAD_FORBIDDEN',
      status: 403,
    });
  });

  it('rejects report downloads when the caller lacks canSendCareReport', async () => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        id: 'file_2',
        orgId: 'org_1',
        purpose: 'report',
        storageKey: 'reports/org_1/report_1/file_2-report.pdf',
        originalName: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        status: 'uploaded',
        reportId: 'report_1',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: '2026-03-28T00:00:00.000Z',
        downloadDisposition: 'inline',
      },
    });

    await expect(
      createPresignedDownload({
        orgId: 'org_1',
        fileId: 'file_2',
        accessContext: {
          userId: 'clerk_1',
          role: 'clerk',
        },
      }),
    ).rejects.toMatchObject({
      code: 'FILE_DOWNLOAD_FORBIDDEN',
      status: 403,
    });
  });

  it('rejects report downloads for author-only roles before signing a URL', async () => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        id: 'file_2',
        orgId: 'org_1',
        purpose: 'report',
        storageKey: 'reports/org_1/report_1/file_2-report.pdf',
        originalName: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        status: 'uploaded',
        reportId: 'report_1',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: '2026-03-28T00:00:00.000Z',
        downloadDisposition: 'inline',
      },
    });

    await expect(
      createPresignedDownload({
        orgId: 'org_1',
        fileId: 'file_2',
        accessContext: {
          userId: 'trainee_1',
          role: 'pharmacist_trainee',
        },
      }),
    ).rejects.toMatchObject({
      code: 'FILE_DOWNLOAD_FORBIDDEN',
      status: 403,
    });
    expect(getSignedUrlMock).not.toHaveBeenCalled();
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
  });

  it('signs linked contract document PDF downloads for patient-sharing managers', async () => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        id: 'contract_file_1',
        orgId: 'org_1',
        purpose: 'contract-document',
        storageKey:
          'contract-documents/org_1/generated/contract-document-contract_1/contract_file_1-contract.pdf',
        originalName: 'contract.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        status: 'uploaded',
        jobId: 'contract-document-contract_1',
        uploadedBy: 'user_1',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: '2026-03-28T00:00:00.000Z',
        downloadDisposition: 'attachment',
      },
    });
    contractDocumentFindFirstMock.mockResolvedValue({ id: 'contract_document_1' });

    const result = await createPresignedDownload({
      orgId: 'org_1',
      fileId: 'contract_file_1',
      accessContext: {
        userId: 'user_1',
        role: 'pharmacist',
      },
    });

    expect(result.downloadUrl).toBe('https://example.com/upload');
    expect(contractDocumentFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        file_id: 'contract_file_1',
      },
      select: { id: true },
    });
    const getObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(getObjectCommand.input).toMatchObject({
      Key: 'contract-documents/org_1/generated/contract-document-contract_1/contract_file_1-contract.pdf',
      ResponseContentDisposition: 'attachment; filename="contract-document-contract_file_1.pdf"',
    });
  });

  it('rejects unlinked contract document PDF downloads before signing a URL', async () => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        id: 'contract_file_1',
        orgId: 'org_1',
        purpose: 'contract-document',
        storageKey:
          'contract-documents/org_1/generated/contract-document-contract_1/contract_file_1-contract.pdf',
        originalName: 'contract.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        status: 'uploaded',
        jobId: 'contract-document-contract_1',
        uploadedBy: 'user_1',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: '2026-03-28T00:00:00.000Z',
        downloadDisposition: 'attachment',
      },
    });
    contractDocumentFindFirstMock.mockResolvedValue(null);

    await expect(
      createPresignedDownload({
        orgId: 'org_1',
        fileId: 'contract_file_1',
        accessContext: {
          userId: 'user_1',
          role: 'pharmacist',
        },
      }),
    ).rejects.toMatchObject({
      code: 'FILE_METADATA_NOT_FOUND',
      status: 404,
    });
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it.each(fileAccessCases)(
    'allows completion for an org-wide pharmacist regardless of assignment on $purpose files',
    async ({ record, deny }) => {
      mockStoredFile({
        ...record,
        status: 'pending_upload',
        completedAt: null,
      });
      // assignment 上は未割当でも、組織内フルアクセスロールは許可される。
      deny();
      s3SendMock.mockResolvedValueOnce({
        ETag: '"etag-123"',
        ContentLength: 2048,
        ContentType: 'application/pdf',
      });

      const result = await completeUploadedFile({
        orgId: 'org_1',
        fileId: 'file_1',
        uploadedBy: 'user_unassigned',
        accessContext: unassignedAccessContext,
      });

      expect(result.status).toBe('uploaded');
      expect(settingUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            value: expect.objectContaining({
              status: 'uploaded',
              uploadedBy: 'user_unassigned',
            }),
          },
        }),
      );
    },
  );

  it.each(fileAccessCases)(
    'allows completion for an authorized pharmacist on $purpose files',
    async ({ record, authorize }) => {
      mockStoredFile({
        ...record,
        status: 'pending_upload',
        completedAt: null,
      });
      authorize();
      s3SendMock.mockResolvedValueOnce({
        ETag: '"etag-123"',
        ContentLength: 2048,
        ContentType: 'application/pdf',
      });

      const result = await completeUploadedFile({
        orgId: 'org_1',
        fileId: 'file_1',
        uploadedBy: 'user_1',
        accessContext: assignedAccessContext,
      });

      expect(result.status).toBe('uploaded');
      expect(settingUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            value: expect.objectContaining({
              status: 'uploaded',
              uploadedBy: 'user_1',
            }),
          },
        }),
      );
    },
  );

  it('rejects completion for archived prescription patients while keeping downloads read-only', async () => {
    mockStoredFile({
      purpose: 'prescription',
      patientId: 'patient_1',
      visitRecordId: null,
      storageKey: 'prescriptions/org_1/patient_1/file_1-prescription.pdf',
      originalName: 'prescription.pdf',
      status: 'pending_upload',
      completedAt: null,
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    await expect(
      completeUploadedFile({
        orgId: 'org_1',
        fileId: 'file_1',
        uploadedBy: 'user_1',
        accessContext: assignedAccessContext,
      }),
    ).rejects.toMatchObject({
      code: 'PATIENT_ARCHIVED',
      status: 409,
    });

    expect(s3SendMock).not.toHaveBeenCalled();
    expect(settingUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects completion for archived patients linked through visit photos', async () => {
    mockStoredFile({
      purpose: 'visit-photo',
      visitRecordId: 'visit_1',
      patientId: null,
      reportId: null,
      storageKey: 'visit-photos/org_1/visit_1/file_1-note.pdf',
      status: 'pending_upload',
      completedAt: null,
    });
    mockVisitRecordAssignment('user_1');
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    await expect(
      completeUploadedFile({
        orgId: 'org_1',
        fileId: 'file_1',
        uploadedBy: 'user_1',
        accessContext: assignedAccessContext,
      }),
    ).rejects.toMatchObject({
      code: 'PATIENT_ARCHIVED',
      status: 409,
    });

    expect(s3SendMock).not.toHaveBeenCalled();
    expect(settingUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects completion for archived patients linked through report visit records', async () => {
    mockStoredFile({
      purpose: 'report',
      reportId: 'report_1',
      visitRecordId: null,
      patientId: null,
      storageKey: 'reports/org_1/report_1/file_1-report.pdf',
      originalName: 'report.pdf',
      status: 'pending_upload',
      completedAt: null,
    });
    mockReportLinkedToVisitRecord();
    mockVisitRecordAssignment('user_1');
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    await expect(
      completeUploadedFile({
        orgId: 'org_1',
        fileId: 'file_1',
        uploadedBy: 'user_1',
        accessContext: assignedAccessContext,
      }),
    ).rejects.toMatchObject({
      code: 'PATIENT_ARCHIVED',
      status: 409,
    });

    expect(s3SendMock).not.toHaveBeenCalled();
    expect(settingUpdateMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects completion for archived patients linked through report cases even for bypass roles', async () => {
    mockStoredFile({
      purpose: 'report',
      reportId: 'report_1',
      visitRecordId: null,
      patientId: null,
      storageKey: 'reports/org_1/report_1/file_1-report.pdf',
      originalName: 'report.pdf',
      status: 'pending_upload',
      completedAt: null,
    });
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: null,
      case_id: 'case_1',
      visit_record_id: null,
    });
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'other_user',
      backup_pharmacist_id: null,
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    await expect(
      completeUploadedFile({
        orgId: 'org_1',
        fileId: 'file_1',
        uploadedBy: 'owner_1',
        accessContext: { userId: 'owner_1', role: 'owner' },
      }),
    ).rejects.toMatchObject({
      code: 'PATIENT_ARCHIVED',
      status: 409,
    });

    expect(s3SendMock).not.toHaveBeenCalled();
    expect(settingUpdateMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
  });

  it.each(fileAccessCases)(
    'allows presigned downloads for an org-wide pharmacist regardless of assignment on $purpose files',
    async ({ record, deny }) => {
      mockStoredFile({
        ...record,
        status: 'uploaded',
      });
      // assignment 上は未割当でも、組織内フルアクセスロールは許可される。
      deny();

      const result = await createPresignedDownload({
        orgId: 'org_1',
        fileId: 'file_1',
        accessContext: unassignedAccessContext,
      });

      expect(result.downloadUrl).toBe('https://example.com/upload');
      expect(getSignedUrlMock).toHaveBeenCalledOnce();
    },
  );

  it('syncs report upload completion to CareReport.pdf_url', async () => {
    mockStoredFile({
      purpose: 'report',
      reportId: 'report_1',
      visitRecordId: null,
      storageKey: 'reports/org_1/report_1/file_1-report.pdf',
      originalName: 'report.pdf',
      status: 'pending_upload',
      completedAt: null,
    });
    mockReportLinkedToVisitRecord();
    mockVisitRecordAssignment('user_1');

    const result = await completeUploadedFile({
      orgId: 'org_1',
      fileId: 'file_1',
      uploadedBy: 'user_1',
      accessContext: assignedAccessContext,
    });

    expect(result.status).toBe('uploaded');
    expect(careReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
      },
      data: {
        pdf_url: '/api/files/file_1/download',
      },
    });
  });

  it('retries CareReport.pdf_url sync for an already uploaded report file', async () => {
    mockStoredFile({
      purpose: 'report',
      reportId: 'report_1',
      visitRecordId: null,
      storageKey: 'reports/org_1/report_1/file_1-report.pdf',
      originalName: 'report.pdf',
      status: 'uploaded',
      uploadedBy: 'original_user',
      completedAt: '2026-03-28T00:00:00.000Z',
    });
    mockReportLinkedToVisitRecord();
    mockVisitRecordAssignment('user_1');

    const result = await completeUploadedFile({
      orgId: 'org_1',
      fileId: 'file_1',
      uploadedBy: 'retry_user',
      accessContext: assignedAccessContext,
    });

    expect(result.status).toBe('uploaded');
    expect(s3SendMock).not.toHaveBeenCalled();
    expect(settingUpdateMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
      },
      data: {
        pdf_url: '/api/files/file_1/download',
      },
    });
  });

  it.each(fileAccessCases)(
    'allows presigned downloads for an authorized pharmacist on $purpose files',
    async ({ record, authorize }) => {
      mockStoredFile({
        ...record,
        status: 'uploaded',
      });
      authorize();

      const result = await createPresignedDownload({
        orgId: 'org_1',
        fileId: 'file_1',
        accessContext: assignedAccessContext,
      });

      expect(result.downloadUrl).toBe('https://example.com/upload');
      expect(getSignedUrlMock).toHaveBeenCalledOnce();
    },
  );

  it('verifies the uploaded object exists before marking it uploaded', async () => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        id: 'file_1',
        orgId: 'org_1',
        purpose: 'visit-photo',
        storageKey: 'visit-photos/org_1/visit_1/file_1-note.pdf',
        originalName: 'note.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        status: 'pending_upload',
        visitRecordId: 'visit_1',
        uploadedBy: null,
        etag: null,
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: null,
        downloadDisposition: 'inline',
      },
    });
    s3SendMock.mockResolvedValueOnce({
      ETag: '"etag-123"',
      ContentLength: 2048,
      ContentType: 'application/pdf',
    });

    const result = await completeUploadedFile({
      orgId: 'org_1',
      fileId: 'file_1',
      uploadedBy: 'user_1',
      accessContext: assignedAccessContext,
      etag: '"etag-123"',
    });

    const headObjectCommand = s3SendMock.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(headObjectCommand.input).toMatchObject({
      Bucket: 'ph-os-files',
      Key: 'visit-photos/org_1/visit_1/file_1-note.pdf',
    });
    expect(settingUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'setting_1' },
        data: {
          value: expect.objectContaining({
            status: 'uploaded',
            uploadedBy: 'user_1',
            etag: 'etag-123',
          }),
        },
      }),
    );
    expect(result.etag).toBe('etag-123');
  });

  it('keeps completed file metadata unchanged when completion is retried', async () => {
    mockStoredFile({
      status: 'uploaded',
      uploadedBy: 'original_user',
      etag: 'etag-123',
      completedAt: '2026-03-28T00:00:00.000Z',
    });

    const result = await completeUploadedFile({
      orgId: 'org_1',
      fileId: 'file_1',
      uploadedBy: 'retry_user',
      accessContext: assignedAccessContext,
      etag: '"different-etag"',
    });

    expect(result).toMatchObject({
      status: 'uploaded',
      uploadedBy: 'original_user',
      etag: 'etag-123',
      completedAt: '2026-03-28T00:00:00.000Z',
    });
    expect(s3SendMock).not.toHaveBeenCalled();
    expect(settingUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects completion when the uploaded object size does not match metadata', async () => {
    mockStoredFile({
      status: 'pending_upload',
      completedAt: null,
    });
    s3SendMock.mockResolvedValueOnce({
      ETag: '"etag-123"',
      ContentLength: 1024,
      ContentType: 'application/pdf',
    });

    await expect(
      completeUploadedFile({
        orgId: 'org_1',
        fileId: 'file_1',
        uploadedBy: 'user_1',
        accessContext: assignedAccessContext,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_NOT_READY',
      status: 409,
    });
    expect(settingUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects completion when the uploaded object Content-Type does not match metadata', async () => {
    mockStoredFile({
      status: 'pending_upload',
      completedAt: null,
    });
    s3SendMock.mockResolvedValueOnce({
      ETag: '"etag-123"',
      ContentLength: 2048,
      ContentType: 'image/png',
    });

    await expect(
      completeUploadedFile({
        orgId: 'org_1',
        fileId: 'file_1',
        uploadedBy: 'user_1',
        accessContext: assignedAccessContext,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_NOT_READY',
      status: 409,
    });
    expect(settingUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects completion when the caller-provided ETag does not match the uploaded object', async () => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        id: 'file_1',
        orgId: 'org_1',
        purpose: 'visit-photo',
        storageKey: 'visit-photos/org_1/visit_1/file_1-note.pdf',
        originalName: 'note.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        status: 'pending_upload',
        visitRecordId: 'visit_1',
        uploadedBy: null,
        etag: null,
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: null,
        downloadDisposition: 'inline',
      },
    });
    s3SendMock.mockResolvedValueOnce({
      ETag: '"remote-etag"',
      ContentLength: 2048,
      ContentType: 'application/pdf',
    });

    await expect(
      completeUploadedFile({
        orgId: 'org_1',
        fileId: 'file_1',
        uploadedBy: 'user_1',
        accessContext: assignedAccessContext,
        etag: '"client-etag"',
      }),
    ).rejects.toMatchObject({
      code: 'FILE_NOT_READY',
      status: 409,
    });
    expect(settingUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects completion when the uploaded object does not exist in S3', async () => {
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        id: 'file_1',
        orgId: 'org_1',
        purpose: 'visit-photo',
        storageKey: 'visit-photos/org_1/visit_1/file_1-note.pdf',
        originalName: 'note.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        status: 'pending_upload',
        visitRecordId: 'visit_1',
        uploadedBy: null,
        etag: null,
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: null,
        downloadDisposition: 'inline',
      },
    });
    s3SendMock.mockRejectedValueOnce({
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });

    await expect(
      completeUploadedFile({
        orgId: 'org_1',
        fileId: 'file_1',
        uploadedBy: 'user_1',
        accessContext: assignedAccessContext,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_NOT_READY',
      status: 409,
    });
    expect(settingUpdateMock).not.toHaveBeenCalled();
  });
});
