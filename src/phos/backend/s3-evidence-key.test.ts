import { describe, expect, it } from 'vitest';
import {
  assertTenantS3Key,
  buildEvidenceKey,
  buildExportKey,
  buildReportKey,
  normalizeExtension,
  TenantStorageKeyError,
  validateEvidenceUploadRequest,
} from './s3-evidence-key';
import type { TenantContext } from './tenant-context';

const ctx = { tenant_id: 'tenant_abc123' } as TenantContext;

describe('PH-OS S3 evidence key contract', () => {
  it('builds tenant-prefixed evidence, report, and export keys', () => {
    expect(
      buildEvidenceKey(ctx, {
        card_id: 'card_1',
        evidence_id: 'evidence_1',
        file_name_or_ext: 'photo.JPG',
      }),
    ).toBe('tenants/tenant_abc123/evidence/card_1/evidence_1.jpg');
    expect(buildReportKey(ctx, { year: '2026', month: '06', report_id: 'report_1' })).toBe(
      'tenants/tenant_abc123/reports/2026/06/report_1.pdf',
    );
    expect(buildExportKey(ctx, { year: '2026', month: '06', export_id: 'export_1' })).toBe(
      'tenants/tenant_abc123/exports/2026/06/export_1.zip',
    );
  });

  it('normalizes safe extensions', () => {
    expect(normalizeExtension('evidence.heic')).toBe('heic');
    expect(normalizeExtension('PDF')).toBe('pdf');
  });

  it('rejects cross-tenant and path traversal keys', () => {
    expect(() => assertTenantS3Key(ctx, 'tenants/other/evidence/card/evidence.jpg')).toThrow(
      TenantStorageKeyError,
    );
    expect(() => assertTenantS3Key(ctx, 'tenants/tenant_abc123/evidence/../secret.jpg')).toThrow(
      TenantStorageKeyError,
    );
  });

  it('rejects unsafe client upload input before presigning', () => {
    const base = {
      idempotency_key: 'idem_evidence_1',
      card_id: 'card_1',
      evidence_type: 'PHOTO',
      file_name: 'photo.jpg',
      mime_type: 'image/jpeg',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
    };

    expect(() => validateEvidenceUploadRequest(base)).not.toThrow();
    expect(() =>
      validateEvidenceUploadRequest({
        ...base,
        evidence_type: 'VISIT_PHOTO',
        file_name: 'visit.png',
        mime_type: 'image/png',
      }),
    ).not.toThrow();
    expect(() =>
      validateEvidenceUploadRequest({
        ...base,
        evidence_type: 'DOCUMENT',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
      }),
    ).not.toThrow();
    expect(() =>
      validateEvidenceUploadRequest({ ...base, s3_key: 'tenants/other/evidence/x/y.jpg' }),
    ).toThrow(TenantStorageKeyError);
    expect(() => validateEvidenceUploadRequest({ ...base, card_id: '../card_1' })).toThrow(
      TenantStorageKeyError,
    );
    expect(() => validateEvidenceUploadRequest({ ...base, sha256: 'bad' })).toThrow(
      TenantStorageKeyError,
    );
    expect(() => validateEvidenceUploadRequest({ ...base, mime_type: 'not-a-mime' })).toThrow(
      TenantStorageKeyError,
    );
    expect(() =>
      validateEvidenceUploadRequest({
        ...base,
        file_name: 'photo.svg',
        mime_type: 'image/svg+xml',
      }),
    ).toThrow(TenantStorageKeyError);
    expect(() =>
      validateEvidenceUploadRequest({ ...base, file_name: 'photo.jpg', mime_type: 'text/html' }),
    ).toThrow(TenantStorageKeyError);
    expect(() =>
      validateEvidenceUploadRequest({
        ...base,
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
      }),
    ).toThrow(TenantStorageKeyError);
    expect(() => validateEvidenceUploadRequest({ ...base, size_bytes: 0 })).toThrow(
      TenantStorageKeyError,
    );
  });
});
