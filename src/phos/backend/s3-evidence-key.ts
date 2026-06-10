import type { EvidenceUploadRequest } from '@/phos/contracts/phos_contracts';
import type { TenantContext } from './tenant-context';

export class TenantStorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantStorageKeyError';
  }
}

function tenantPrefix(ctx: Pick<TenantContext, 'tenant_id'>): string {
  return `tenants/${ctx.tenant_id}`;
}

function assertSafeSegment(value: string, label: string): void {
  if (!value || value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new TenantStorageKeyError(`${label} contains an unsafe path segment`);
  }
}

const EVIDENCE_MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  heic: ['image/heic'],
  heif: ['image/heif'],
  pdf: ['application/pdf'],
};

const IMAGE_EVIDENCE_TYPES = new Set(['PHOTO', 'VISIT_PHOTO']);
const DOCUMENT_EVIDENCE_TYPES = new Set(['DOCUMENT', 'PDF']);

export function normalizeExtension(fileNameOrExt: string): string {
  const raw = fileNameOrExt.includes('.') ? fileNameOrExt.split('.').pop() : fileNameOrExt;
  const ext = (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!ext) throw new TenantStorageKeyError('file extension is required');
  return ext;
}

export function buildEvidenceKey(
  ctx: Pick<TenantContext, 'tenant_id'>,
  input: { card_id: string; evidence_id: string; file_name_or_ext: string },
): string {
  assertSafeSegment(input.card_id, 'card_id');
  assertSafeSegment(input.evidence_id, 'evidence_id');
  return `${tenantPrefix(ctx)}/evidence/${input.card_id}/${input.evidence_id}.${normalizeExtension(input.file_name_or_ext)}`;
}

export function buildReportKey(
  ctx: Pick<TenantContext, 'tenant_id'>,
  input: { year: string; month: string; report_id: string },
): string {
  assertSafeSegment(input.year, 'year');
  assertSafeSegment(input.month, 'month');
  assertSafeSegment(input.report_id, 'report_id');
  return `${tenantPrefix(ctx)}/reports/${input.year}/${input.month}/${input.report_id}.pdf`;
}

export function buildExportKey(
  ctx: Pick<TenantContext, 'tenant_id'>,
  input: { year: string; month: string; export_id: string },
): string {
  assertSafeSegment(input.year, 'year');
  assertSafeSegment(input.month, 'month');
  assertSafeSegment(input.export_id, 'export_id');
  return `${tenantPrefix(ctx)}/exports/${input.year}/${input.month}/${input.export_id}.zip`;
}

export function assertTenantS3Key(ctx: Pick<TenantContext, 'tenant_id'>, key: string): void {
  const prefix = `${tenantPrefix(ctx)}/`;
  if (!key.startsWith(prefix) || key.includes('../') || key.includes('..\\')) {
    throw new TenantStorageKeyError(`S3 key is not scoped to tenant ${ctx.tenant_id}`);
  }
}

export function validateEvidenceUploadRequest(input: EvidenceUploadRequest): void {
  if ('s3_key' in input) {
    throw new TenantStorageKeyError('client supplied s3_key is forbidden');
  }
  assertSafeSegment(input.card_id, 'card_id');
  const evidenceType = input.evidence_type.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(evidenceType)) {
    throw new TenantStorageKeyError('evidence_type is invalid');
  }
  const mimeType = input.mime_type.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(mimeType)) {
    throw new TenantStorageKeyError('mime_type is invalid');
  }
  const extension = normalizeExtension(input.file_name);
  if (!EVIDENCE_MIME_BY_EXTENSION[extension]?.includes(mimeType)) {
    throw new TenantStorageKeyError('mime_type does not match file extension');
  }
  if (extension === 'pdf') {
    if (!DOCUMENT_EVIDENCE_TYPES.has(evidenceType)) {
      throw new TenantStorageKeyError('evidence_type does not allow PDF uploads');
    }
  } else if (!IMAGE_EVIDENCE_TYPES.has(evidenceType)) {
    throw new TenantStorageKeyError('evidence_type does not allow image uploads');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.sha256))
    throw new TenantStorageKeyError('sha256 must be a hex digest');
  if (!Number.isSafeInteger(input.size_bytes) || input.size_bytes <= 0) {
    throw new TenantStorageKeyError('size_bytes must be positive');
  }
}
