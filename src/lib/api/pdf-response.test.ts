import { describe, expect, it } from 'vitest';
import { expectPhiExportSnapshotRedacted } from '@/test/api-response-assertions';
import { pdfResponse } from './pdf-response';

function contentDispositionFor(fileName: string) {
  return pdfResponse(Buffer.from('%PDF'), fileName).headers.get('Content-Disposition') ?? '';
}

describe('pdfResponse', () => {
  it('sets a PDF response with no-store headers', () => {
    const response = pdfResponse(Buffer.from('%PDF'), 'care-report.pdf');

    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Disposition')).toBe(
      `inline; filename="care-report.pdf"; filename*=UTF-8''care-report.pdf`,
    );
  });

  it('adds a pdf extension to benign extensionless names', () => {
    expect(contentDispositionFor('visit-record')).toContain('visit-record.pdf');
  });

  it('falls back when filenames contain PHI, storage, tokens, or raw provider markers', () => {
    const disposition = contentDispositionFor(
      '../Taro Yamada 090-1234-5678 アムロジピン storageKey=s3 token=secret provider raw error.pdf',
    );

    expect(disposition).toBe(`inline; filename="document.pdf"; filename*=UTF-8''document.pdf`);
    expectPhiExportSnapshotRedacted(disposition, ['Taro', 'Yamada', '..', '/', '\\']);
  });

  it('removes header injection characters before writing Content-Disposition', () => {
    const disposition = contentDispositionFor('report\r\nSet-Cookie: token=secret.pdf');

    expect(disposition).toBe(`inline; filename="document.pdf"; filename*=UTF-8''document.pdf`);
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
    expect(disposition).not.toContain('Set-Cookie');
    expect(disposition).not.toContain('token=secret');
  });
});
