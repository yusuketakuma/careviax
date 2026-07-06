import { describe, expect, it } from 'vitest';
import {
  buildAuditedConsentDocumentUrl,
  normalizeAuditedConsentDocumentUrl,
  serializeConsentRecordDocumentUrl,
} from './consent-record-documents';

describe('consent-record-documents', () => {
  it('builds canonical audited consent document urls', () => {
    expect(buildAuditedConsentDocumentUrl('file_1')).toBe('/api/files/file_1/download');
  });

  it('encodes hostile file ids as one audited download path segment', () => {
    const url = buildAuditedConsentDocumentUrl('../file?x=1#secret');

    expect(url).toBe('/api/files/..%2Ffile%3Fx%3D1%23secret/download');
    expect(url).not.toContain('/file?');
    expect(url).not.toContain('#secret');
  });

  it.each(['.', '..'])('rejects exact dot-segment file ids (%s)', (fileId) => {
    expect(() => buildAuditedConsentDocumentUrl(fileId)).toThrow(RangeError);
  });

  it('normalizes relative audited consent document urls only', () => {
    expect(normalizeAuditedConsentDocumentUrl(' /api/files/file_1/download ')).toBe(
      '/api/files/file_1/download',
    );
  });

  it('normalizes legacy presigned audited urls to the same-origin download route', () => {
    expect(
      normalizeAuditedConsentDocumentUrl(' /api/files/file_1/presigned-download?download=1 '),
    ).toBe('/api/files/file_1/download');
    expect(normalizeAuditedConsentDocumentUrl('/api/files/file_1/presigned-download')).toBeNull();
  });

  it('redacts audited-looking urls with encoded dot-segment file ids', () => {
    expect(normalizeAuditedConsentDocumentUrl('/api/files/%2E/download')).toBeNull();
    expect(normalizeAuditedConsentDocumentUrl('/api/files/%2E%2E/download')).toBeNull();
  });

  it('rejects external and absolute audited-looking urls', () => {
    expect(normalizeAuditedConsentDocumentUrl('https://files.example.test/consent.pdf')).toBeNull();
    expect(
      normalizeAuditedConsentDocumentUrl('https://evil.example/api/files/file_1/download'),
    ).toBeNull();
  });

  it('serializes legacy raw document urls as redacted metadata', () => {
    expect(
      serializeConsentRecordDocumentUrl({
        id: 'consent_1',
        document_url: 'https://files.example.test/legacy-consent.pdf',
      }),
    ).toMatchObject({
      id: 'consent_1',
      document_url: null,
      has_document_url: true,
      document_url_redacted: true,
    });
  });

  it('serializes document_file_id as the canonical audited document url', () => {
    expect(
      serializeConsentRecordDocumentUrl({
        id: 'consent_1',
        document_url: 'https://files.example.test/legacy-consent.pdf',
        document_file_id: 'file_1',
      }),
    ).toMatchObject({
      id: 'consent_1',
      document_url: '/api/files/file_1/download',
      has_document_url: true,
      document_url_redacted: false,
    });
  });
});
