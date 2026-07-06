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
import { awsClientConfig, withAwsClientTimeout } from '@/lib/aws/client-timeout';
import { hasPermission } from '@/lib/auth/permissions';
import {
  canAccessVisitScheduleAssignment,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';
import { prisma } from '@/lib/db/client';
import { buildFileDownloadHref } from '@/lib/files/navigation';
import { readJsonObject } from '@/lib/db/json';
import { logger } from '@/lib/utils/logger';

const FILE_SETTING_PREFIX = 'file_asset:';
const UPLOAD_EXPIRY_SECONDS = 60 * 5;
const DOWNLOAD_EXPIRY_SECONDS = 60 * 15;
const PRESCRIPTION_OBJECT_LOCK_YEARS = 5;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_BULK_EXPORT_RETENTION_HOURS = 72;
const DEFAULT_CONTRACT_DOCUMENT_RETENTION_YEARS = 7;
const MAX_BULK_EXPORT_CLEANUP_BATCH_SIZE = 100;
const DEFAULT_BULK_EXPORT_CLEANUP_MAX_PAGES = 10;
const EXPIRED_GENERATED_FILE_CLEANUP_ERROR = '保持期限切れファイルの削除に失敗しました';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_MIME_TYPES = new Set([...IMAGE_MIME_TYPES, 'application/pdf']);
const VISIT_ATTACHMENT_MIME_TYPES = new Set([...DOCUMENT_MIME_TYPES]);

const DOWNLOAD_FILE_STEM_BY_PURPOSE: Record<AnyFilePurpose, string> = {
  prescription: 'prescription-file',
  'visit-photo': 'visit-attachment',
  report: 'report-file',
  'set-photo': 'set-photo',
  'consent-document': 'consent-document',
  'contract-document': 'contract-document',
  'bulk-export': 'bulk-export',
};

const DOWNLOAD_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type FilePurpose =
  | 'prescription'
  | 'visit-photo'
  | 'report'
  | 'set-photo'
  | 'consent-document'
  | 'contract-document';
type GeneratedFilePurpose = 'bulk-export' | 'contract-document';
type AnyFilePurpose = FilePurpose | GeneratedFilePurpose;
type StoredFileStatus = 'pending_upload' | 'uploaded';
type DownloadDisposition = 'inline' | 'attachment';
type SupportedServerSideEncryption = 'AES256' | 'aws:kms';

function isAnyFilePurpose(value: unknown): value is AnyFilePurpose {
  return (
    value === 'prescription' ||
    value === 'visit-photo' ||
    value === 'report' ||
    value === 'set-photo' ||
    value === 'consent-document' ||
    value === 'bulk-export' ||
    value === 'contract-document'
  );
}

function isStoredFileStatus(value: unknown): value is StoredFileStatus {
  return value === 'pending_upload' || value === 'uploaded';
}

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

type FileAssetRow = {
  id: string;
  org_id: string;
  purpose: string;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  patient_id: string | null;
  visit_record_id: string | null;
  report_id: string | null;
  job_id: string | null;
  uploaded_by: string | null;
  etag: string | null;
  completed_at: Date | null;
  expires_at: Date | null;
  download_disposition: string;
  created_at: Date;
  updated_at: Date;
};

type FileAssetStore = {
  findFirst(args: unknown): Promise<FileAssetRow | null>;
  findMany(args: unknown): Promise<FileAssetRow[]>;
  upsert(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  deleteMany(args: unknown): Promise<unknown>;
};

type CareReportPdfUrlStore = {
  updateMany(args: unknown): Promise<unknown>;
};

type StoredFileLookup = {
  record: StoredFileRecord;
  settingId: string | null;
  fileAssetId: string | null;
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
      | 'FILE_METADATA_LOOKUP_FAILED'
      | 'FILE_NOT_READY'
      | 'FILE_UPLOAD_REFERENCE_MISSING'
      | 'FILE_UPLOAD_INVALID_MIME'
      | 'FILE_UPLOAD_TOO_LARGE'
      | 'FILE_METADATA_WRITE_FAILED'
      | 'FILE_COMPLETE_FORBIDDEN'
      | 'FILE_DOWNLOAD_FORBIDDEN'
      | 'FILE_DELETE_FORBIDDEN'
      | 'PATIENT_ARCHIVED'
      | 'FILE_EXPIRED',
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FileStorageError';
  }
}

const s3Clients = new Map<string, S3Client>();

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
  if (Number.isSafeInteger(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_BULK_EXPORT_RETENTION_HOURS;
}

function normalizeCleanupPositiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;

  const normalized = Math.trunc(value);
  if (!Number.isSafeInteger(normalized)) return fallback;

  return Math.max(normalized, 1);
}

function normalizeCleanupBatchSize(value: number | undefined) {
  return Math.min(
    normalizeCleanupPositiveInteger(value, MAX_BULK_EXPORT_CLEANUP_BATCH_SIZE),
    MAX_BULK_EXPORT_CLEANUP_BATCH_SIZE,
  );
}

function resolveBulkExportExpiresAt(base: Date) {
  return new Date(base.getTime() + resolveBulkExportRetentionHours() * 60 * 60 * 1000);
}

function resolveContractDocumentRetentionYears() {
  const configured = Number.parseInt(process.env.CONTRACT_DOCUMENT_FILE_RETENTION_YEARS ?? '', 10);
  if (Number.isSafeInteger(configured) && configured >= 1 && configured <= 30) {
    return configured;
  }
  return DEFAULT_CONTRACT_DOCUMENT_RETENTION_YEARS;
}

function resolveContractDocumentExpiresAt(base: Date) {
  const expiresAt = new Date(base);
  expiresAt.setFullYear(expiresAt.getFullYear() + resolveContractDocumentRetentionYears());
  return expiresAt;
}

function resolveKmsKeyId(purpose: AnyFilePurpose) {
  const explicitPurposeKey =
    purpose === 'bulk-export'
      ? process.env.S3_KMS_KEY_ID_EXPORT
      : purpose === 'report' || purpose === 'contract-document'
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
  const { region } = getRequiredStorageConfig();
  const cached = s3Clients.get(region);
  if (cached) return cached;

  const client = withAwsClientTimeout(new S3Client({ region, ...awsClientConfig() }));
  s3Clients.set(region, client);
  return client;
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

function resolveSafeDownloadFileName(record: StoredFileRecord) {
  const stem = DOWNLOAD_FILE_STEM_BY_PURPOSE[record.purpose];
  const extension = DOWNLOAD_EXTENSION_BY_MIME_TYPE[record.mimeType] ?? 'bin';
  return sanitizeFileName(`${stem}-${record.id}.${extension}`);
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
    args.purpose === 'contract-document'
      ? new Set(['application/pdf'])
      : args.purpose === 'visit-photo' || args.purpose === 'set-photo'
        ? VISIT_ATTACHMENT_MIME_TYPES
        : DOCUMENT_MIME_TYPES;

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

function assertUploadReferenceIds(args: CreatePresignedUploadArgs) {
  const missingReference =
    (args.purpose === 'prescription' && !args.patientId) ||
    (args.purpose === 'consent-document' && !args.patientId) ||
    (args.purpose === 'visit-photo' && !args.visitRecordId) ||
    (args.purpose === 'report' && !args.reportId);

  if (!missingReference) return;

  throw new FileStorageError(
    'FILE_UPLOAD_REFERENCE_MISSING',
    'ファイルアップロードに必要な参照先 ID が指定されていません',
    400,
  );
}

export function assertFileUploadConstraints(args: {
  purpose: FilePurpose;
  mimeType: string;
  sizeBytes: number;
}) {
  assertAllowedUpload(args);
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
    case 'consent-document':
      return `consent-documents/${args.orgId}/${args.patientId}/${args.fileId}-${safeName}`;
    case 'visit-photo':
      return `visit-photos/${args.orgId}/${args.visitRecordId}/${args.fileId}-${safeName}`;
    case 'report':
      return args.reportId
        ? `reports/${args.orgId}/${args.reportId}/${args.fileId}-${safeName}`
        : `reports/${args.orgId}/generated/${args.jobId}/${args.fileId}-${safeName}`;
    case 'set-photo':
      return `set-audits/${args.orgId}/${args.fileId}-${safeName}`;
    case 'bulk-export':
      return `bulk-exports/${args.orgId}/${args.jobId}/${args.fileId}-${safeName}`;
    case 'contract-document':
      return args.jobId
        ? `contract-documents/${args.orgId}/generated/${args.jobId}/${args.fileId}-${safeName}`
        : `contract-documents/${args.orgId}/uploaded/${args.fileId}-${safeName}`;
  }
}

function toSettingKey(fileId: string) {
  return `${FILE_SETTING_PREFIX}${fileId}`;
}

function getFileAssetStore(): FileAssetStore | null {
  return (prisma as unknown as { fileAsset?: FileAssetStore }).fileAsset ?? null;
}

function nullableDateFromIso(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function fileAssetRowToStoredRecord(row: FileAssetRow): StoredFileRecord | null {
  return parseStoredFileRecord({
    version: 1,
    id: row.id,
    orgId: row.org_id,
    purpose: row.purpose,
    storageKey: row.storage_key,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    patientId: row.patient_id,
    visitRecordId: row.visit_record_id,
    reportId: row.report_id,
    jobId: row.job_id,
    uploadedBy: row.uploaded_by,
    etag: row.etag,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    downloadDisposition: row.download_disposition,
  });
}

function storedRecordToFileAssetData(record: StoredFileRecord) {
  return {
    org_id: record.orgId,
    purpose: record.purpose,
    storage_key: record.storageKey,
    original_name: record.originalName,
    mime_type: record.mimeType,
    size_bytes: record.sizeBytes,
    status: record.status,
    patient_id: record.patientId ?? null,
    visit_record_id: record.visitRecordId ?? null,
    report_id: record.reportId ?? null,
    job_id: record.jobId ?? null,
    uploaded_by: record.uploadedBy ?? null,
    etag: record.etag ?? null,
    completed_at: nullableDateFromIso(record.completedAt),
    expires_at: nullableDateFromIso(record.expiresAt),
    download_disposition: record.downloadDisposition ?? 'inline',
  };
}

function normalizeStoredReferenceId(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function inferBulkExportJobIdFromStorageKey(storageKey: string, orgId: string) {
  const prefix = `bulk-exports/${orgId}/`;
  if (!storageKey.startsWith(prefix)) return null;
  const [jobId, fileSegment, ...extraSegments] = storageKey.slice(prefix.length).split('/');
  if (!jobId || !fileSegment || extraSegments.length > 0) return null;
  return jobId;
}

function hasExpectedStorageKeyPrefix(storageKey: string, prefix: string) {
  const suffix = storageKey.slice(prefix.length);
  return storageKey.startsWith(prefix) && suffix.length > 0 && !suffix.includes('/');
}

function isStoredFileReferenceConsistent(record: {
  orgId: string;
  purpose: AnyFilePurpose;
  storageKey: string;
  patientId: string | null;
  visitRecordId: string | null;
  reportId: string | null;
  jobId: string | null;
}) {
  switch (record.purpose) {
    case 'prescription':
    case 'consent-document':
      return (
        record.patientId !== null &&
        hasExpectedStorageKeyPrefix(
          record.storageKey,
          record.purpose === 'prescription'
            ? `prescriptions/${record.orgId}/${record.patientId}/`
            : `consent-documents/${record.orgId}/${record.patientId}/`,
        )
      );
    case 'visit-photo':
      return (
        record.visitRecordId !== null &&
        hasExpectedStorageKeyPrefix(
          record.storageKey,
          `visit-photos/${record.orgId}/${record.visitRecordId}/`,
        )
      );
    case 'report':
      return (
        record.reportId !== null &&
        hasExpectedStorageKeyPrefix(
          record.storageKey,
          `reports/${record.orgId}/${record.reportId}/`,
        )
      );
    case 'set-photo':
      return hasExpectedStorageKeyPrefix(record.storageKey, `set-audits/${record.orgId}/`);
    case 'bulk-export':
      return (
        record.jobId !== null &&
        hasExpectedStorageKeyPrefix(
          record.storageKey,
          `bulk-exports/${record.orgId}/${record.jobId}/`,
        )
      );
    case 'contract-document':
      if (record.jobId) {
        return hasExpectedStorageKeyPrefix(
          record.storageKey,
          `contract-documents/${record.orgId}/generated/${record.jobId}/`,
        );
      }
      return hasExpectedStorageKeyPrefix(
        record.storageKey,
        `contract-documents/${record.orgId}/uploaded/`,
      );
  }
}

function parseStoredFileRecord(value: unknown): StoredFileRecord | null {
  const record = readJsonObject(value);
  if (!record) return null;
  if (
    record.version !== 1 ||
    typeof record.id !== 'string' ||
    typeof record.orgId !== 'string' ||
    !isAnyFilePurpose(record.purpose) ||
    typeof record.storageKey !== 'string' ||
    typeof record.originalName !== 'string' ||
    typeof record.mimeType !== 'string' ||
    typeof record.sizeBytes !== 'number' ||
    !Number.isFinite(record.sizeBytes) ||
    !isStoredFileStatus(record.status) ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null;
  }

  const normalizedRecord = {
    orgId: record.orgId,
    purpose: record.purpose,
    storageKey: record.storageKey,
    patientId: normalizeStoredReferenceId(record.patientId),
    visitRecordId: normalizeStoredReferenceId(record.visitRecordId),
    reportId: normalizeStoredReferenceId(record.reportId),
    jobId:
      normalizeStoredReferenceId(record.jobId) ??
      inferBulkExportJobIdFromStorageKey(record.storageKey, record.orgId),
  };

  if (!isStoredFileReferenceConsistent(normalizedRecord)) {
    return null;
  }

  return {
    version: 1,
    id: record.id,
    orgId: record.orgId,
    purpose: record.purpose,
    storageKey: record.storageKey,
    originalName: sanitizeFileName(record.originalName),
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    status: record.status,
    patientId: normalizedRecord.patientId,
    visitRecordId: normalizedRecord.visitRecordId,
    reportId: normalizedRecord.reportId,
    jobId: normalizedRecord.jobId,
    uploadedBy: typeof record.uploadedBy === 'string' ? record.uploadedBy : null,
    etag: typeof record.etag === 'string' ? record.etag : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : null,
    expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : null,
    downloadDisposition: record.downloadDisposition === 'attachment' ? 'attachment' : 'inline',
  };
}

function resolveStoredFileExpiresAt(
  record: StoredFileRecord,
  opts?: { includeLegacyFallback?: boolean },
) {
  if (record.purpose !== 'bulk-export' && record.purpose !== 'contract-document') return null;

  const explicitExpiry = record.expiresAt ? new Date(record.expiresAt) : null;
  if (explicitExpiry && Number.isFinite(explicitExpiry.getTime())) {
    return explicitExpiry;
  }

  if (record.purpose === 'contract-document') return null;

  if (!opts?.includeLegacyFallback) return null;

  const base = new Date(record.completedAt ?? record.createdAt);
  if (!Number.isFinite(base.getTime())) return null;
  return resolveBulkExportExpiresAt(base);
}

async function upsertFileAssetRecord(record: StoredFileRecord) {
  const store = getFileAssetStore();
  if (!store) {
    if (record.purpose === 'contract-document') {
      throw new FileStorageError(
        'FILE_METADATA_WRITE_FAILED',
        '契約書ファイルメタデータを保存できません',
        502,
      );
    }
    return;
  }

  const fileAssetData = storedRecordToFileAssetData(record);
  try {
    await store.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        ...fileAssetData,
      },
      update: fileAssetData,
    });
  } catch (error) {
    logger.warn({
      event: 'file_storage.file_asset_upsert_failed',
      orgId: record.orgId,
      entityType: 'file',
      entityId: record.id,
      filePurpose: record.purpose,
      code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    });
    if (record.purpose === 'contract-document') {
      throw new FileStorageError(
        'FILE_METADATA_WRITE_FAILED',
        '契約書ファイルメタデータを保存できません',
        502,
      );
    }
  }
}

async function upsertLegacySettingRecord(record: StoredFileRecord) {
  await prisma.setting.upsert({
    where: {
      scope_scope_id_key: {
        scope: 'organization',
        scope_id: record.orgId,
        key: toSettingKey(record.id),
      },
    },
    create: {
      scope: 'organization',
      scope_id: record.orgId,
      key: toSettingKey(record.id),
      value: record,
    },
    update: {
      value: record,
    },
  });
}

async function persistStoredFileRecord(record: StoredFileRecord) {
  await upsertFileAssetRecord(record);
  await upsertLegacySettingRecord(record);
}

async function readStoredFileRecord(orgId: string, fileId: string): Promise<StoredFileLookup> {
  const store = getFileAssetStore();
  const fileAsset = store
    ? await (async () => {
        try {
          return await store.findFirst({
            where: {
              id: fileId,
              org_id: orgId,
            },
          });
        } catch (error) {
          logger.warn({
            event: 'file_storage.file_asset_lookup_failed',
            orgId,
            entityType: 'file',
            entityId: fileId,
            code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          });
          throw new FileStorageError(
            'FILE_METADATA_LOOKUP_FAILED',
            'ファイルメタデータの確認に失敗しました',
            502,
          );
        }
      })()
    : null;

  const assetRecord = fileAsset ? fileAssetRowToStoredRecord(fileAsset) : null;
  if (fileAsset && assetRecord) {
    return { fileAssetId: fileAsset.id, settingId: null, record: assetRecord };
  }

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

  await upsertFileAssetRecord(record);

  return { settingId: setting.id, fileAssetId: null, record };
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

function buildStoredFileDownloadUrl(record: StoredFileRecord) {
  return buildFileDownloadHref(record.id);
}

async function syncReportPdfUrl(record: StoredFileRecord) {
  if (record.purpose !== 'report' || !record.reportId) return;

  const careReportStore = (prisma as unknown as { careReport?: CareReportPdfUrlStore }).careReport;
  if (!careReportStore || typeof careReportStore.updateMany !== 'function') return;

  await careReportStore.updateMany({
    where: {
      id: record.reportId,
      org_id: record.orgId,
    },
    data: {
      pdf_url: buildStoredFileDownloadUrl(record),
    },
  });
}

function assertRoleAuthorizedForStoredFile(
  record: StoredFileRecord,
  accessContext: FileAccessContext,
  mode: StoredFileAccessMode,
) {
  if (record.purpose === 'report') {
    if (!hasPermission(accessContext.role, 'canSendCareReport')) {
      throwFileAccessForbidden(mode, '報告書ファイルへのアクセス権限がありません');
    }
    return;
  }

  if (record.purpose === 'contract-document') {
    if (!hasPermission(accessContext.role, 'canManagePatientSharing')) {
      throwFileAccessForbidden(mode, '薬局間契約書ファイルへのアクセス権限がありません');
    }
    return;
  }

  if (record.purpose === 'set-photo') {
    if (!hasPermission(accessContext.role, 'canAuditSet')) {
      throwFileAccessForbidden(mode, 'セット監査写真へのアクセス権限がありません');
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
      patient_id: true,
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

  if (args.mode === 'complete') {
    await assertPatientNotArchivedForFileCompletion({
      orgId: args.orgId,
      patientId: visitRecord.patient_id,
    });
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
      patient_id: true,
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

  if (args.mode === 'complete') {
    await assertPatientNotArchivedForFileCompletion({
      orgId: args.orgId,
      patientId: careCase.patient_id,
    });
  }
}

async function assertPatientNotArchivedForFileCompletion(args: {
  orgId: string;
  patientId: string | null | undefined;
}) {
  if (!args.patientId) {
    throwFileMetadataNotFound('ファイルに紐づく患者が見つかりません');
  }

  const patient = await prisma.patient.findFirst({
    where: {
      id: args.patientId,
      org_id: args.orgId,
    },
    select: { id: true, archived_at: true },
  });

  if (!patient) {
    throwFileMetadataNotFound('ファイルに紐づく患者が見つかりません');
  }

  if (patient.archived_at) {
    throw new FileStorageError(
      'PATIENT_ARCHIVED',
      'アーカイブ中の患者は復元するまで更新できません',
      409,
    );
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
    select: { id: true, archived_at: true },
  });

  if (!patient) {
    throwFileMetadataNotFound('ファイルに紐づく患者が見つかりません');
  }

  if (args.mode === 'complete' && patient.archived_at) {
    throw new FileStorageError(
      'PATIENT_ARCHIVED',
      'アーカイブ中の患者は復元するまで更新できません',
      409,
    );
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
    case 'consent-document':
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
    case 'set-photo':
      // ロール認可は assertRoleAuthorizedForStoredFile(canAuditSet) で実施済み。
      // セット監査写真は患者/訪問/報告のような個別参照を持たず org スコープ(RLS)で分離。
      return;
    case 'bulk-export':
      if (
        !canBypassVisitScheduleAssignmentAccess(args.accessContext) &&
        args.record.uploadedBy !== args.accessContext.userId
      ) {
        throwFileAccessForbidden(args.mode, 'この一括出力ファイルへのアクセス権限がありません');
      }
      return;
    case 'contract-document': {
      if (args.mode === 'complete') return;

      const linkedDocument = await prisma.contractDocument.findFirst({
        where: {
          org_id: args.orgId,
          file_id: args.record.id,
        },
        select: { id: true },
      });
      if (!linkedDocument) {
        throwFileMetadataNotFound('ファイルに紐づく薬局間契約書が見つかりません');
      }
      return;
    }
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
  assertUploadReferenceIds(args);
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
    expiresAt:
      args.purpose === 'contract-document'
        ? resolveContractDocumentExpiresAt(new Date(now)).toISOString()
        : null,
    downloadDisposition: args.purpose === 'contract-document' ? 'attachment' : 'inline',
  };

  await persistStoredFileRecord(record);

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
        : args.purpose === 'contract-document'
          ? resolveContractDocumentExpiresAt(new Date(now)).toISOString()
          : null,
    downloadDisposition: args.downloadDisposition ?? 'inline',
  };

  try {
    await persistStoredFileRecord(record);
  } catch (error) {
    await deleteGeneratedFile(record).catch((cleanupError) => {
      logger.error(
        {
          event: 'file_storage.generated_cleanup_failed',
          orgId: args.orgId,
          entityType: 'file',
          entityId: fileId,
          filePurpose: args.purpose,
          code: 'GENERATED_METADATA_CLEANUP_FAILED',
        },
        cleanupError,
      );
    });
    throw error;
  }

  return record;
}

export async function deleteGeneratedFile(record: StoredFileRecord) {
  if (record.purpose !== 'bulk-export' && record.purpose !== 'contract-document') {
    throw new FileStorageError(
      'FILE_DELETE_FORBIDDEN',
      '生成ファイル以外はこの削除処理の対象外です',
      403,
    );
  }

  if (record.purpose === 'contract-document') {
    const linkedDocument = await prisma.contractDocument.findFirst({
      where: {
        org_id: record.orgId,
        file_id: record.id,
      },
      select: { id: true },
    });
    if (linkedDocument) {
      throw new FileStorageError(
        'FILE_DELETE_FORBIDDEN',
        'リンク済み薬局間契約書ファイルはこの削除処理の対象外です',
        403,
      );
    }
  }

  const { bucketName } = getRequiredStorageConfig();
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: record.storageKey,
    }),
  );
  await getFileAssetStore()
    ?.deleteMany({
      where: {
        id: record.id,
        org_id: record.orgId,
      },
    })
    .catch((error) => {
      logger.warn({
        event: 'file_storage.file_asset_delete_failed',
        orgId: record.orgId,
        entityType: 'file',
        entityId: record.id,
        filePurpose: record.purpose,
        code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
    });
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
  const batchSize = normalizeCleanupBatchSize(args?.batchSize);
  const maxPages = normalizeCleanupPositiveInteger(
    args?.maxPages,
    DEFAULT_BULK_EXPORT_CLEANUP_MAX_PAGES,
  );

  const errors: string[] = [];
  let processedCount = 0;
  let scannedCount = 0;
  let assetCursor: { id: string } | undefined;
  const store = getFileAssetStore();

  if (store) {
    try {
      for (let page = 0; page < maxPages; page += 1) {
        const assets = await store.findMany({
          where: {
            purpose: 'bulk-export',
            status: 'uploaded',
            expires_at: { lte: now },
            ...(args?.orgId ? { org_id: args.orgId } : {}),
          },
          orderBy: {
            id: 'asc',
          },
          take: batchSize,
          ...(assetCursor ? { cursor: assetCursor, skip: 1 } : {}),
        });

        if (assets.length === 0) break;
        scannedCount += assets.length;
        assetCursor = { id: assets[assets.length - 1].id };

        for (const asset of assets) {
          const record = fileAssetRowToStoredRecord(asset);
          if (!record) continue;

          try {
            await deleteGeneratedFile(record);
            processedCount += 1;
          } catch {
            errors.push(EXPIRED_GENERATED_FILE_CLEANUP_ERROR);
          }
        }

        if (assets.length < batchSize) break;
      }
    } catch (error) {
      logger.warn({
        event: 'file_storage.file_asset_cleanup_scan_failed',
        orgId: args?.orgId,
        entityType: 'file_asset',
        code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
    }
  }

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
      } catch {
        errors.push(EXPIRED_GENERATED_FILE_CLEANUP_ERROR);
      }
    }

    if (settings.length < batchSize) break;
  }

  // 保持期限切れファイルの削除に失敗が残った場合、呼び出し側の検査有無に依らず観測可能にする
  // (PHI 隣接の bulk-export が保持期間を過ぎても削除されない=コンプライアンス上の retention gap)。
  if (errors.length > 0) {
    logger.warn('expired generated file cleanup completed with deletion failures', {
      event: 'file_storage.expired_cleanup_partial_failure',
      orgId: args?.orgId,
      entityType: 'file_asset',
      failed_count: errors.length,
      processed_count: processedCount,
      scanned_count: scannedCount,
    });
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

  if (record.status === 'uploaded') {
    await syncReportPdfUrl(record);
    return record;
  }

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

  await upsertFileAssetRecord(nextRecord);
  if (settingId) {
    await prisma.setting.update({
      where: { id: settingId },
      data: {
        value: nextRecord,
      },
    });
  } else {
    await upsertLegacySettingRecord(nextRecord);
  }
  await syncReportPdfUrl(nextRecord);

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

  const downloadFileName = resolveSafeDownloadFileName(record);
  const downloadUrl = await getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: bucketName,
      Key: record.storageKey,
      ResponseContentType: record.mimeType,
      ResponseContentDisposition: `${record.downloadDisposition ?? 'inline'}; filename="${downloadFileName}"`,
    }),
    { expiresIn: DOWNLOAD_EXPIRY_SECONDS },
  );

  return {
    id: record.id,
    fileName: downloadFileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    purpose: record.purpose,
    downloadUrl,
    expiresIn: DOWNLOAD_EXPIRY_SECONDS,
  };
}
