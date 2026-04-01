import crypto from 'node:crypto';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '@/lib/db/client';

const FILE_SETTING_PREFIX = 'file_asset:';
const UPLOAD_EXPIRY_SECONDS = 60 * 5;
const DOWNLOAD_EXPIRY_SECONDS = 60 * 15;
const PRESCRIPTION_OBJECT_LOCK_YEARS = 5;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_MIME_TYPES = new Set([...IMAGE_MIME_TYPES, 'application/pdf']);
const VISIT_ATTACHMENT_MIME_TYPES = new Set([...DOCUMENT_MIME_TYPES]);

type FilePurpose = 'prescription' | 'visit-photo' | 'report';
type GeneratedFilePurpose = 'bulk-export';
type AnyFilePurpose = FilePurpose | GeneratedFilePurpose;
type StoredFileStatus = 'pending_upload' | 'uploaded';
type DownloadDisposition = 'inline' | 'attachment';
type SupportedServerSideEncryption = 'AES256' | 'aws:kms';

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
  etag?: string | null;
};

type CreatePresignedDownloadArgs = {
  orgId: string;
  fileId: string;
  permissions: {
    canVisit: boolean;
    canReport: boolean;
  };
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
      | 'FILE_DOWNLOAD_FORBIDDEN',
    message: string,
    readonly status: number
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
      503
    );
  }

  return { bucketName, region };
}

function getServerSideEncryptionMode(): SupportedServerSideEncryption {
  return process.env.S3_SERVER_SIDE_ENCRYPTION === 'aws:kms' ? 'aws:kms' : 'AES256';
}

function resolveKmsKeyId(purpose: AnyFilePurpose) {
  const explicitPurposeKey =
    purpose === 'bulk-export'
      ? process.env.S3_KMS_KEY_ID_EXPORT
      : purpose === 'report'
        ? process.env.S3_KMS_KEY_ID_REPORT
        : undefined;

  return (
    explicitPurposeKey ??
    process.env.S3_KMS_KEY_ID_PHI ??
    process.env.S3_KMS_KEY_ID ??
    null
  );
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
      503
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

function assertAllowedUpload(args: {
  purpose: FilePurpose;
  mimeType: string;
  sizeBytes: number;
}) {
  const allowedMimeTypes =
    args.purpose === 'visit-photo' ? VISIT_ATTACHMENT_MIME_TYPES : DOCUMENT_MIME_TYPES;

  if (!allowedMimeTypes.has(args.mimeType)) {
    throw new FileStorageError(
      'FILE_UPLOAD_INVALID_MIME',
      '許可されていない MIME タイプです',
      400
    );
  }

  const maxBytes =
    args.mimeType === 'application/pdf' ? DOCUMENT_MAX_BYTES : IMAGE_MAX_BYTES;

  if (args.sizeBytes > maxBytes) {
    throw new FileStorageError(
      'FILE_UPLOAD_TOO_LARGE',
      `ファイルサイズが上限を超えています（上限 ${Math.floor(maxBytes / (1024 * 1024))}MB）`,
      400
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
    downloadDisposition:
      record.downloadDisposition === 'attachment' ? 'attachment' : 'inline',
  };
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
      404
    );
  }

  return { settingId: setting.id, record };
}

function assertDownloadAuthorized(
  record: StoredFileRecord,
  permissions: CreatePresignedDownloadArgs['permissions'],
) {
  if (record.purpose === 'report') {
    if (!permissions.canReport) {
      throw new FileStorageError(
        'FILE_DOWNLOAD_FORBIDDEN',
        '報告書ファイルのダウンロード権限がありません',
        403,
      );
    }
    return;
  }

  if (!permissions.canVisit) {
    throw new FileStorageError(
      'FILE_DOWNLOAD_FORBIDDEN',
      '診療・訪問関連ファイルのダウンロード権限がありません',
      403,
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
    { expiresIn: UPLOAD_EXPIRY_SECONDS }
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
    })
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
    downloadDisposition: args.downloadDisposition ?? 'inline',
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

  return record;
}

export async function completeUploadedFile({
  orgId,
  fileId,
  uploadedBy,
  etag,
}: CompleteUploadArgs) {
  const { bucketName } = getRequiredStorageConfig();
  const { settingId, record } = await readStoredFileRecord(orgId, fileId);
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
  permissions,
}: CreatePresignedDownloadArgs) {
  const { bucketName } = getRequiredStorageConfig();
  const { record } = await readStoredFileRecord(orgId, fileId);

  if (record.status !== 'uploaded') {
    throw new FileStorageError(
      'FILE_NOT_READY',
      'ファイルアップロードがまだ完了していません',
      409
    );
  }

  assertDownloadAuthorized(record, permissions);

  const downloadUrl = await getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: bucketName,
      Key: record.storageKey,
      ResponseContentType: record.mimeType,
      ResponseContentDisposition: `${record.downloadDisposition ?? 'inline'}; filename="${record.originalName}"`,
    }),
    { expiresIn: DOWNLOAD_EXPIRY_SECONDS }
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
