import crypto from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { MemberRole } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { hasPermission } from '@/lib/auth/permissions';
import {
  canAccessVisitScheduleAssignment,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';

const FILE_SETTING_PREFIX = 'file_asset:';
const UPLOAD_EXPIRY_SECONDS = 60 * 5;
const DOWNLOAD_EXPIRY_SECONDS = 60 * 15;
const PRESCRIPTION_OBJECT_LOCK_YEARS = 5;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_BULK_EXPORT_RETENTION_HOURS = 72;
const MAX_BULK_EXPORT_CLEANUP_BATCH_SIZE = 100;

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_MIME_TYPES = new Set([...IMAGE_MIME_TYPES, 'application/pdf']);
const VISIT_ATTACHMENT_MIME_TYPES = new Set([...DOCUMENT_MIME_TYPES]);

type FilePurpose = 'prescription' | 'visit-photo' | 'report';
type GeneratedFilePurpose = 'bulk-export';
type AnyFilePurpose = FilePurpose | GeneratedFilePurpose;
type StoredFileStatus = 'pending_upload' | 'uploaded';
type DownloadDisposition = 'inline' | 'attachment';
type SupportedServerSideEncryption = 'AES256' | 'aws:kms';

type FileAccessContext = {
  userId: string;
  role: MemberRole;
};

type StoredFileAccessMode = 'complete' | 'download';

export type StoredFileRecord = {
  version: 1;
  id: string;
  orgId: string;
  purpose: AnyFilePurpose;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: StoredFileStatus;
  patientId?: string | null;
  visitRecordId?: string | null;
  reportId?: string | null;
  jobId?: string | null;
  uploadedBy?: string | null;
  etag?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  expiresAt?: string | null;
  downloadDisposition?: DownloadDisposition;
};

export type VisitRecordAttachment = {
  file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string | null;
  kind: 'photo' | 'attachment';
};

type CreatePresignedUploadArgs = {
  orgId: string;
  purpose: FilePurpose;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  patientId?: string | null;
  visitRecordId?: string | null;
  reportId?: string | null;
};

type CompleteUploadArgs = {
  orgId: string;
  fileId: string;
  uploadedBy: string;
  accessContext: FileAccessContext;
  etag?: string | null;
};

type CreatePresignedDownloadArgs = {
  orgId: string;
  fileId: string;
  accessContext: FileAccessContext;
};

type StoreGeneratedFileArgs = {
  orgId: string;
  purpose: GeneratedFilePurpose;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  uploadedBy: string;
  jobId: string;
  downloadDisposition?: DownloadDisposition;
};

export class FileStorageError extends Error {
  constructor(
    readonly code:
      | 'FILE_STORAGE_NOT_CONFIGURED'
      | 'FILE_METADATA_NOT_FOUND'
      | 'FILE_NOT_READY'
      | 'FILE_UPLOAD_INVALID_MIME'
      | 'FILE_UPLOAD_TOO_LARGE'
      | 'FILE_COMPLETE_FORBIDDEN'
      | 'FILE_DOWNLOAD_FORBIDDEN'
      | 'FILE_DELETE_FORBIDDEN'
      | 'FILE_EXPIRED',
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FileStorageError';
  }
}

let cachedClient: S3Client | null = null;

function getRequiredStorageConfig() {
  const bucketName = process.env.S3_BUCKET_NAME;
  const region = process.env.S3_BUCKET_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-1';

  if (!bucketName) {
    throw new FileStorageError(
      'FILE_STORAGE_NOT_CONFIGURED',
      'S3_BUCKET_NAME が設定されていません',
      503,
    );
  }

  return { bucketName, region };
}

function getServerSideEncryptionMode(): SupportedServerSideEncryption {
  return process.env.S3_SERVER_SIDE_ENCRYPTION === 'aws:kms' ? 'aws:kms' : 'AES256';
}

function resolveBulkExportRetentionHours() {
  const configured = Number.parseInt(process.env.BULK_EXPORT_FILE_RETENTION_HOURS ?? '', 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_BULK_EXPORT_RETENTION_HOURS;
}

function resolveBulkExportExpiresAt(base: Date) {
  return new Date(base.getTime() + resolveBulkExportRetentionHours() * 60 * 60 * 1000);
}

function resolveKmsKeyId(purpose: AnyFilePurpose) {
  const explicitPurposeKey =
    purpose === 'bulk-export'
      ? process.env.S3_KMS_KEY_ID_EXPORT
      : purpose === 'report'
        ? process.env.S3_KMS_KEY_ID_REPORT
        : undefined;

  return explicitPurposeKey ?? process.env.S3_KMS_KEY_ID_PHI ?? process.env.S3_KMS_KEY_ID ?? null;
}

function getS3EncryptionConfig(purpose: AnyFilePurpose) {
  const mode = getServerSideEncryptionMode();
  if (mode === 'AES256') {
    return {
      commandInput: {
        ServerSideEncryption: 'AES256' as const,
      },
      headers: {
        'x-amz-server-side-encryption': 'AES256',
      },
    };
  }

  const kmsKeyId = resolveKmsKeyId(purpose);
  if (!kmsKeyId) {
    throw new FileStorageError(
      'FILE_STORAGE_NOT_CONFIGURED',
      'S3 KMS 暗号化に必要な KMS キー ID が設定されていません',
      503,
    );
  }

  return {
    commandInput: {
      ServerSideEncryption: 'aws:kms' as const,
      SSEKMSKeyId: kmsKeyId,
    },
    headers: {
      'x-amz-server-side-encryption': 'aws:kms',
      'x-amz-server-side-encryption-aws-kms-key-id': kmsKeyId,
    },
  };
}

function getClient() {
  if (cachedClient) return cachedClient;

  const { region } = getRequiredStorageConfig();
  cachedClient = new S3Client({ region });
  return cachedClient;
}

function normalizeEtag(etag: string | null | undefined) {
  if (!etag) return null;
  const normalized = etag.trim().replace(/^"+|"+$/g, '');
  return normalized.length > 0 ? normalized : null;
}

function isMissingS3ObjectError(error: unknown) {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    name?: string;
    code?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };

  return (
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.code === 'NotFound' ||
    candidate.Code === 'NotFound' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function sanitizeFileName(fileName: string) {
  const normalized = fileName.trim().replaceAll(/[^A-Za-z0-9._-]/g, '_');
  return normalized.length > 0 ? normalized.slice(-120) : 'upload.bin';
}

function buildPrescriptionObjectLockRetention(purpose: FilePurpose) {
  if (purpose !== 'prescription') return null;

  const retainUntil = new Date();
  retainUntil.setFullYear(retainUntil.getFullYear() + PRESCRIPTION_OBJECT_LOCK_YEARS);

  return {
    mode: 'COMPLIANCE' as const,
    retainUntil,
  };
}

function assertAllowedUpload(args: { purpose: FilePurpose; mimeType: string; sizeBytes: number }) {
  const allowedMimeTypes =
    args.purpose === 'visit-photo' ? VISIT_ATTACHMENT_MIME_TYPES : DOCUMENT_MIME_TYPES;

  if (!allowedMimeTypes.has(args.mimeType)) {
    throw new FileStorageError('FILE_UPLOAD_INVALID_MIME', '許可されていない MIME タイプです', 400);
  }

  const maxBytes = args.mimeType === 'application/pdf' ? DOCUMENT_MAX_BYTES : IMAGE_MAX_BYTES;

  if (args.sizeBytes > maxBytes) {
    throw new FileStorageError(
      'FILE_UPLOAD_TOO_LARGE',
      `ファイルサイズが上限を超えています（上限 ${Math.floor(maxBytes / (1024 * 1024))}MB）`,
      400,
    );
  }
}

function buildStorageKey(args: {
  orgId: string;
  purpose: AnyFilePurpose;
  fileId: string;
  fileName: string;
  patientId?: string | null;
  visitRecordId?: string | null;
  reportId?: string | null;
  jobId?: string | null;
}) {
  const safeName = sanitizeFileName(args.fileName);

  switch (args.purpose) {
    case 'prescription':
      return `prescriptions/${args.orgId}/${args.patientId}/${args.fileId}-${safeName}`;
    case 'visit-photo':
      return `visit-photos/${args.orgId}/${args.visitRecordId}/${args.fileId}-${safeName}`;
    case 'report':
      return `reports/${args.orgId}/${args.reportId}/${args.fileId}-${safeName}`;
    case 'bulk-export':
      return `bulk-exports/${args.orgId}/${args.jobId}/${args.fileId}-${safeName}`;
  }
}

function toSettingKey(fileId: string) {
  return `${FILE_SETTING_PREFIX}${fileId}`;
}

function parseStoredFileRecord(value: unknown): StoredFileRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.id !== 'string' ||
    typeof record.orgId !== 'string' ||
    typeof record.purpose !== 'string' ||
    typeof record.storageKey !== 'string' ||
    typeof record.originalName !== 'string' ||
    typeof record.mimeType !== 'string' ||
    typeof record.sizeBytes !== 'number' ||
    typeof record.status !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    version: 1,
    id: record.id,
    orgId: record.orgId,
    purpose: record.purpose as AnyFilePurpose,
    storageKey: record.storageKey,
    originalName: record.originalName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    status: record.status as StoredFileStatus,
    patientId: typeof record.patientId === 'string' ? record.patientId : null,
    visitRecordId: typeof record.visitRecordId === 'string' ? record.visitRecordId : null,
    reportId: typeof record.reportId === 'string' ? record.reportId : null,
    jobId: typeof record.jobId === 'string' ? record.jobId : null,
    uploadedBy: typeof record.uploadedBy === 'string' ? record.uploadedBy : null,
    etag: typeof record.etag === 'string' ? record.etag : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : null,
    expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : null,
    downloadDisposition: record.downloadDisposition === 'attachment' ? 'attachment' : 'inline',
  };
}

function resolveStoredFileExpiresAt(record: StoredFileRecord, opts?: { includeLegacyFallback?: boolean }) {
  if (record.purpose !== 'bulk-export') return null;

  const explicitExpiry = record.expiresAt ? new Date(record.expiresAt) : null;
  if (explicitExpiry && Number.isFinite(explicitExpiry.getTime())) {
    return explicitExpiry;
  }

  if (!opts?.includeLegacyFallback) return null;

  const base = new Date(record.completedAt ?? record.createdAt);
  if (!Number.isFinite(base.getTime())) return null;
  return resolveBulkExportExpiresAt(base);
}

async function readStoredFileRecord(orgId: string, fileId: string) {
  const setting = await prisma.setting.findFirst({
    where: {
      scope: 'organization',
      scope_id: orgId,
      key: toSettingKey(fileId),
    },
    select: {
      id: true,
      value: true,
    },
  });

  const record = parseStoredFileRecord(setting?.value);
  if (!setting || !record) {
    throw new FileStorageError(
      'FILE_METADATA_NOT_FOUND',
      'ファイルメタデータが見つかりません',
      404,
    );
  }

  return { settingId: setting.id, record };
}

function fileForbiddenCode(mode: StoredFileAccessMode) {
  return mode === 'download' ? 'FILE_DOWNLOAD_FORBIDDEN' : 'FILE_COMPLETE_FORBIDDEN';
}

function throwFileAccessForbidden(mode: StoredFileAccessMode, message: string): never {
  throw new FileStorageError(fileForbiddenCode(mode), message, 403);
}

function throwFileMetadataNotFound(message = 'ファイルに紐づく参照先が見つかりません'): never {
  throw new FileStorageError('FILE_METADATA_NOT_FOUND', message, 404);
}

function assertRoleAuthorizedForStoredFile(
  record: StoredFileRecord,
  accessContext: FileAccessContext,
  mode: StoredFileAccessMode,
) {
  if (record.purpose === 'report') {
    if (!hasPermission(accessContext.role, 'canReport')) {
      throwFileAccessForbidden(mode, '報告書ファイルへのアクセス権限がありません');
    }
    return;
  }

  if (!hasPermission(accessContext.role, 'canVisit')) {
    throwFileAccessForbidden(mode, '診療・訪問関連ファイルへのアクセス権限がありません');
  }
}

async function assertVisitRecordFileAccess(args: {
  orgId: string;
  visitRecordId: string | null | undefined;
  accessContext: FileAccessContext;
  mode: StoredFileAccessMode;
}) {
  if (!args.visitRecordId) {
    throwFileMetadataNotFound('ファイルに紐づく訪問記録が見つかりません');
  }

  const visitRecord = await prisma.visitRecord.findFirst({
    where: {
      id: args.visitRecordId,
      org_id: args.orgId,
    },
    select: {
      id: true,
      schedule: {
        select: {
          pharmacist_id: true,
          case_: {
            select: {
              primary_pharmacist_id: true,
              backup_pharmacist_id: true,
            },
          },
        },
      },
    },
  });

  if (!visitRecord) {
    throwFileMetadataNotFound('ファイルに紐づく訪問記録が見つかりません');
  }

  if (!canAccessVisitScheduleAssignment(args.accessContext, visitRecord.schedule)) {
    throwFileAccessForbidden(args.mode, 'この訪問記録に紐づくファイルへのアクセス権限がありません');
  }
}

async function assertCareCaseFileAccess(args: {
  orgId: string;
  caseId: string | null | undefined;
  accessContext: FileAccessContext;
  mode: StoredFileAccessMode;
}) {
  if (!args.caseId) {
    throwFileMetadataNotFound('ファイルに紐づくケースが見つかりません');
  }

  const careCase = await prisma.careCase.findFirst({
    where: {
      id: args.caseId,
      org_id: args.orgId,
    },
    select: {
      primary_pharmacist_id: true,
      backup_pharmacist_id: true,
    },
  });

  if (!careCase) {
    throwFileMetadataNotFound('ファイルに紐づくケースが見つかりません');
  }

  if (
    !canAccessVisitScheduleAssignment(args.accessContext, {
      pharmacist_id: null,
      case_: careCase,
    })
  ) {
    throwFileAccessForbidden(args.mode, 'このケースに紐づくファイルへのアクセス権限がありません');
  }
}

async function assertPatientFileAccess(args: {
  orgId: string;
  patientId: string | null | undefined;
  accessContext: FileAccessContext;
  mode: StoredFileAccessMode;
}) {
  if (!args.patientId) {
    throwFileMetadataNotFound('ファイルに紐づく患者が見つかりません');
  }

  const patient = await prisma.patient.findFirst({
    where: {
      id: args.patientId,
      org_id: args.orgId,
    },
    select: { id: true },
  });

  if (!patient) {
    throwFileMetadataNotFound('ファイルに紐づく患者が見つかりません');
  }

  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) {
    return;
  }

  const accessibleSchedule = await prisma.visitSchedule.findFirst({
    where: {
      org_id: args.orgId,
      case_: {
        patient_id: args.patientId,
      },
      OR: [
        { pharmacist_id: args.accessContext.userId },
        { case_: { primary_pharmacist_id: args.accessContext.userId } },
        { case_: { backup_pharmacist_id: args.accessContext.userId } },
      ],
    },
    select: { id: true },
  });

  if (accessibleSchedule) {
    return;
  }

  const accessibleCase = await prisma.careCase.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      OR: [
        { primary_pharmacist_id: args.accessContext.userId },
        { backup_pharmacist_id: args.accessContext.userId },
      ],
    },
    select: { id: true },
  });

  if (!accessibleCase) {
    throwFileAccessForbidden(args.mode, 'この患者に紐づくファイルへのアクセス権限がありません');
  }
}

async function assertReportFileAccess(args: {
  orgId: string;
  reportId: string | null | undefined;
  accessContext: FileAccessContext;
  mode: StoredFileAccessMode;
}) {
  if (!args.reportId) {
    throwFileMetadataNotFound('ファイルに紐づく報告書が見つかりません');
  }

  const report = await prisma.careReport.findFirst({
    where: {
      id: args.reportId,
      org_id: args.orgId,
    },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      visit_record_id: true,
    },
  });

  if (!report) {
    throwFileMetadataNotFound('ファイルに紐づく報告書が見つかりません');
  }

  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) {
    return;
  }

  if (report.visit_record_id) {
    await assertVisitRecordFileAccess({
      orgId: args.orgId,
      visitRecordId: report.visit_record_id,
      accessContext: args.accessContext,
      mode: args.mode,
    });
    return;
  }

  if (report.case_id) {
    await assertCareCaseFileAccess({
      orgId: args.orgId,
      caseId: report.case_id,
      accessContext: args.accessContext,
      mode: args.mode,
    });
    return;
  }

  await assertPatientFileAccess({
    orgId: args.orgId,
    patientId: report.patient_id,
    accessContext: args.accessContext,
    mode: args.mode,
  });
}

async function assertStoredFileAccess(args: {
  orgId: string;
  record: StoredFileRecord;
  accessContext: FileAccessContext;
  mode: StoredFileAccessMode;
}) {
  assertRoleAuthorizedForStoredFile(args.record, args.accessContext, args.mode);

  switch (args.record.purpose) {
    case 'visit-photo':
      await assertVisitRecordFileAccess({
        orgId: args.orgId,
        visitRecordId: args.record.visitRecordId,
        accessContext: args.accessContext,
        mode: args.mode,
      });
      return;
    case 'prescription':
      await assertPatientFileAccess({
        orgId: args.orgId,
        patientId: args.record.patientId,
        accessContext: args.accessContext,
        mode: args.mode,
      });
      return;
    case 'report':
      await assertReportFileAccess({
        orgId: args.orgId,
        reportId: args.record.reportId,
        accessContext: args.accessContext,
        mode: args.mode,
      });
      return;
    case 'bulk-export':
      if (
        !canBypassVisitScheduleAssignmentAccess(args.accessContext) &&
        args.record.uploadedBy !== args.accessContext.userId
      ) {
        throwFileAccessForbidden(args.mode, 'この一括出力ファイルへのアクセス権限がありません');
      }
      return;
  }
}

function normalizeContentType(contentType: string | null | undefined) {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? null;
}

function assertUploadedObjectMatchesRecord(
  response: { ContentLength?: number; ContentType?: string },
  record: StoredFileRecord,
) {
  if (typeof response.ContentLength !== 'number' || response.ContentLength !== record.sizeBytes) {
    throw new FileStorageError(
      'FILE_NOT_READY',
      'アップロード済みファイルのサイズ確認に失敗しました',
      409,
    );
  }

  if (normalizeContentType(response.ContentType) !== record.mimeType.toLowerCase()) {
    throw new FileStorageError(
      'FILE_NOT_READY',
      'アップロード済みファイルの MIME タイプ確認に失敗しました',
      409,
    );
  }
}

export async function createPresignedUpload(args: CreatePresignedUploadArgs) {
  const { bucketName } = getRequiredStorageConfig();
  assertAllowedUpload(args);
  const objectLock = buildPrescriptionObjectLockRetention(args.purpose);
  const encryption = getS3EncryptionConfig(args.purpose);

  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const storageKey = buildStorageKey({
    orgId: args.orgId,
    purpose: args.purpose,
    fileId,
    fileName: args.fileName,
    patientId: args.patientId,
    visitRecordId: args.visitRecordId,
    reportId: args.reportId,
  });

  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: bucketName,
      Key: storageKey,
      ContentType: args.mimeType,
      ...encryption.commandInput,
      ...(objectLock
        ? {
            ObjectLockMode: objectLock.mode,
            ObjectLockRetainUntilDate: objectLock.retainUntil,
          }
        : {}),
    }),
    { expiresIn: UPLOAD_EXPIRY_SECONDS },
  );

  const record: StoredFileRecord = {
    version: 1,
    id: fileId,
    orgId: args.orgId,
    purpose: args.purpose,
    storageKey,
    originalName: sanitizeFileName(args.fileName),
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    status: 'pending_upload',
    patientId: args.patientId ?? null,
    visitRecordId: args.visitRecordId ?? null,
    reportId: args.reportId ?? null,
    jobId: null,
    uploadedBy: null,
    etag: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    downloadDisposition: 'inline',
  };

  await prisma.setting.upsert({
    where: {
      scope_scope_id_key: {
        scope: 'organization',
        scope_id: args.orgId,
        key: toSettingKey(fileId),
      },
    },
    create: {
      scope: 'organization',
      scope_id: args.orgId,
      key: toSettingKey(fileId),
      value: record,
    },
    update: {
      value: record,
    },
  });

  return {
    id: fileId,
    uploadUrl,
    objectKey: storageKey,
    expiresIn: UPLOAD_EXPIRY_SECONDS,
    headers: {
      'Content-Type': args.mimeType,
      ...encryption.headers,
      ...(objectLock
        ? {
            'x-amz-object-lock-mode': objectLock.mode,
            'x-amz-object-lock-retain-until-date': objectLock.retainUntil.toISOString(),
          }
        : {}),
    },
  };
}

export async function getStoredFileRecord(orgId: string, fileId: string) {
  const { record } = await readStoredFileRecord(orgId, fileId);
  return record;
}

export function toVisitRecordAttachment(record: StoredFileRecord): VisitRecordAttachment {
  return {
    file_id: record.id,
    file_name: record.originalName,
    mime_type: record.mimeType,
    size_bytes: record.sizeBytes,
    uploaded_at: record.completedAt ?? null,
    kind: record.mimeType.startsWith('image/') ? 'photo' : 'attachment',
  };
}

export async function storeGeneratedFile(args: StoreGeneratedFileArgs) {
  const { bucketName } = getRequiredStorageConfig();
  const encryption = getS3EncryptionConfig(args.purpose);
  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const storageKey = buildStorageKey({
    orgId: args.orgId,
    purpose: args.purpose,
    fileId,
    fileName: args.fileName,
    jobId: args.jobId,
  });

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: storageKey,
      Body: args.buffer,
      ContentType: args.mimeType,
      ...encryption.commandInput,
    }),
  );

  const record: StoredFileRecord = {
    version: 1,
    id: fileId,
    orgId: args.orgId,
    purpose: args.purpose,
    storageKey,
    originalName: sanitizeFileName(args.fileName),
    mimeType: args.mimeType,
    sizeBytes: args.buffer.byteLength,
    status: 'uploaded',
    patientId: null,
    visitRecordId: null,
    reportId: null,
    jobId: args.jobId,
    uploadedBy: args.uploadedBy,
    etag: null,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    expiresAt:
      args.purpose === 'bulk-export'
        ? resolveBulkExportExpiresAt(new Date(now)).toISOString()
        : null,
    downloadDisposition: args.downloadDisposition ?? 'inline',
  };

  try {
    await prisma.setting.upsert({
      where: {
        scope_scope_id_key: {
          scope: 'organization',
          scope_id: args.orgId,
          key: toSettingKey(fileId),
        },
      },
      create: {
        scope: 'organization',
        scope_id: args.orgId,
        key: toSettingKey(fileId),
        value: record,
      },
      update: {
        value: record,
      },
    });
  } catch (error) {
    await getClient()
      .send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: storageKey,
        }),
      )
      .catch((cleanupError) => {
        console.error('[file-storage] failed to clean up generated file after metadata failure', {
          fileId,
          storageKey,
          error: cleanupError,
        });
      });
    throw error;
  }

  return record;
}

export async function deleteGeneratedFile(record: StoredFileRecord) {
  if (record.purpose !== 'bulk-export') {
    throw new FileStorageError(
      'FILE_DELETE_FORBIDDEN',
      '一括出力ファイル以外はこの削除処理の対象外です',
      403,
    );
  }

  const { bucketName } = getRequiredStorageConfig();
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: record.storageKey,
    }),
  );
  await prisma.setting.deleteMany({
    where: {
      scope: 'organization',
      scope_id: record.orgId,
      key: toSettingKey(record.id),
    },
  });
}

export async function cleanupExpiredGeneratedFiles(args?: {
  orgId?: string;
  now?: Date;
  batchSize?: number;
  maxPages?: number;
}) {
  const now = args?.now ?? new Date();
  const batchSize = Math.min(
    Math.max(args?.batchSize ?? MAX_BULK_EXPORT_CLEANUP_BATCH_SIZE, 1),
    MAX_BULK_EXPORT_CLEANUP_BATCH_SIZE,
  );
  const maxPages = Math.max(args?.maxPages ?? 10, 1);

  const errors: string[] = [];
  let processedCount = 0;
  let scannedCount = 0;
  let cursor: { id: string } | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const settings = await prisma.setting.findMany({
      where: {
        scope: 'organization',
        ...(args?.orgId ? { scope_id: args.orgId } : {}),
        key: { startsWith: FILE_SETTING_PREFIX },
      },
      select: {
        id: true,
        value: true,
      },
      orderBy: {
        id: 'asc',
      },
      take: batchSize,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });

    if (settings.length === 0) break;
    scannedCount += settings.length;
    cursor = { id: settings[settings.length - 1].id };

    for (const setting of settings) {
      const record = parseStoredFileRecord(setting.value);
      const expiresAt = record
        ? resolveStoredFileExpiresAt(record, { includeLegacyFallback: true })
        : null;
      if (!record || record.purpose !== 'bulk-export' || !expiresAt || expiresAt > now) {
        continue;
      }

      try {
        await deleteGeneratedFile(record);
        processedCount += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (settings.length < batchSize) break;
  }

  return { processedCount, scannedCount, errors };
}

export async function completeUploadedFile({
  orgId,
  fileId,
  uploadedBy,
  accessContext,
  etag,
}: CompleteUploadArgs) {
  const { bucketName } = getRequiredStorageConfig();
  const { settingId, record } = await readStoredFileRecord(orgId, fileId);
  await assertStoredFileAccess({ orgId, record, accessContext, mode: 'complete' });
  const requestedEtag = normalizeEtag(etag ?? record.etag ?? null);

  let uploadedEtag: string | null = requestedEtag;

  try {
    const response = await getClient().send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: record.storageKey,
      }),
    );

    const remoteEtag = normalizeEtag(response.ETag);
    assertUploadedObjectMatchesRecord(response, record);

    if (requestedEtag && remoteEtag && requestedEtag !== remoteEtag) {
      throw new FileStorageError(
        'FILE_NOT_READY',
        'アップロード済みファイルの整合性確認に失敗しました',
        409,
      );
    }

    uploadedEtag = remoteEtag ?? requestedEtag;
  } catch (error) {
    if (error instanceof FileStorageError) {
      throw error;
    }

    if (isMissingS3ObjectError(error)) {
      throw new FileStorageError(
        'FILE_NOT_READY',
        'ファイル本体のアップロード完了を確認できませんでした',
        409,
      );
    }

    throw error;
  }

  const completedAt = new Date().toISOString();

  const nextRecord: StoredFileRecord = {
    ...record,
    status: 'uploaded',
    uploadedBy,
    etag: uploadedEtag,
    updatedAt: completedAt,
    completedAt,
  };

  await prisma.setting.update({
    where: { id: settingId },
    data: {
      value: nextRecord,
    },
  });

  return nextRecord;
}

export async function createPresignedDownload({
  orgId,
  fileId,
  accessContext,
}: CreatePresignedDownloadArgs) {
  const { bucketName } = getRequiredStorageConfig();
  const { record } = await readStoredFileRecord(orgId, fileId);
  await assertStoredFileAccess({ orgId, record, accessContext, mode: 'download' });

  if (record.status !== 'uploaded') {
    throw new FileStorageError('FILE_NOT_READY', 'ファイルアップロードがまだ完了していません', 409);
  }

  const expiresAt = resolveStoredFileExpiresAt(record);
  if (expiresAt && expiresAt <= new Date()) {
    throw new FileStorageError('FILE_EXPIRED', 'ファイルの保存期限が切れています', 410);
  }

  const downloadUrl = await getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: bucketName,
      Key: record.storageKey,
      ResponseContentType: record.mimeType,
      ResponseContentDisposition: `${record.downloadDisposition ?? 'inline'}; filename="${record.originalName}"`,
    }),
    { expiresIn: DOWNLOAD_EXPIRY_SECONDS },
  );

  return {
    id: record.id,
    fileName: record.originalName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    purpose: record.purpose,
    downloadUrl,
    expiresIn: DOWNLOAD_EXPIRY_SECONDS,
  };
}
