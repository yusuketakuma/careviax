import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSignedUrlMock,
  settingUpsertMock,
  settingFindFirstMock,
  settingUpdateMock,
  randomUuidMock,
  s3SendMock,
} = vi.hoisted(() => ({
  getSignedUrlMock: vi.fn(),
  settingUpsertMock: vi.fn(),
  settingFindFirstMock: vi.fn(),
  settingUpdateMock: vi.fn(),
  randomUuidMock: vi.fn(),
  s3SendMock: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  default: {
    randomUUID: randomUuidMock,
  },
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class S3Client {
    send = s3SendMock;
  },
  PutObjectCommand: class PutObjectCommand {
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
      update: settingUpdateMock,
    },
  },
}));

import {
  completeUploadedFile,
  createPresignedDownload,
  createPresignedUpload,
  storeGeneratedFile,
} from './file-storage';

describe('file-storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = 'careviax-files';
    process.env.S3_BUCKET_REGION = 'ap-northeast-1';
    delete process.env.S3_SERVER_SIDE_ENCRYPTION;
    delete process.env.S3_KMS_KEY_ID;
    delete process.env.S3_KMS_KEY_ID_PHI;
    delete process.env.S3_KMS_KEY_ID_REPORT;
    delete process.env.S3_KMS_KEY_ID_EXPORT;
    randomUuidMock.mockReturnValue('file-uuid-1');
    getSignedUrlMock.mockResolvedValue('https://example.com/upload');
    settingUpsertMock.mockResolvedValue(undefined);
    settingFindFirstMock.mockResolvedValue(null);
    settingUpdateMock.mockResolvedValue(undefined);
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
    const putObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(putObjectCommand.input).toMatchObject({
      Bucket: 'careviax-files',
      Key: 'reports/org_1/report_1/file-uuid-1-report.pdf',
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
    });

    expect(result.headers).toEqual({
      'Content-Type': 'application/pdf',
      'x-amz-server-side-encryption': 'AES256',
    });
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
    const putObjectCommand = s3SendMock.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(putObjectCommand.input).toMatchObject({
      Bucket: 'careviax-files',
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
          }),
        }),
      })
    );
    expect(result.storageKey).toBe('bulk-exports/org_1/job_1/file-uuid-1-medication-history.zip');
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
      Bucket: 'careviax-files',
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
      Bucket: 'careviax-files',
      Key: 'visit-photos/org_1/visit_1/file-uuid-1-visit-note.pdf',
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
    });

    expect(result.headers).toEqual({
      'Content-Type': 'application/pdf',
      'x-amz-server-side-encryption': 'AES256',
    });
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
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        completedAt: '2026-03-28T00:00:00.000Z',
        downloadDisposition: 'attachment',
      },
    });

    await createPresignedDownload({
      orgId: 'org_1',
      fileId: 'file_1',
      permissions: {
        canVisit: true,
        canReport: false,
      },
    });

    const getObjectCommand = getSignedUrlMock.mock.calls[0]?.[1] as {
      input: Record<string, unknown>;
    };
    expect(getObjectCommand.input).toMatchObject({
      ResponseContentDisposition: 'attachment; filename="medication-history.zip"',
    });
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
        permissions: {
          canVisit: false,
          canReport: true,
        },
      }),
    ).rejects.toMatchObject({
      code: 'FILE_DOWNLOAD_FORBIDDEN',
      status: 403,
    });
  });

  it('rejects report downloads when the caller lacks canReport', async () => {
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
        permissions: {
          canVisit: true,
          canReport: false,
        },
      }),
    ).rejects.toMatchObject({
      code: 'FILE_DOWNLOAD_FORBIDDEN',
      status: 403,
    });
  });

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
    s3SendMock.mockResolvedValueOnce({ ETag: '"etag-123"' });

    const result = await completeUploadedFile({
      orgId: 'org_1',
      fileId: 'file_1',
      uploadedBy: 'user_1',
      etag: '"etag-123"',
    });

    const headObjectCommand = s3SendMock.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(headObjectCommand.input).toMatchObject({
      Bucket: 'careviax-files',
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
      }),
    ).rejects.toMatchObject({
      code: 'FILE_NOT_READY',
      status: 409,
    });
    expect(settingUpdateMock).not.toHaveBeenCalled();
  });
});
