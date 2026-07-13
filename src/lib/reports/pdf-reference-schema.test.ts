import { describe, expect, it } from 'vitest';
import { careReportPdfReferenceSchema } from './pdf-reference-schema';

describe('careReportPdfReferenceSchema', () => {
  it.each([
    '/api/files/file_1/download',
    '/api/files/report%2F1%3Fx%3Dy%23frag/download',
    'https://files.example.com/report.pdf',
    'http://localhost:3000/api/files/file_1/download',
  ])('accepts supported report PDF references: %s', (value) => {
    expect(careReportPdfReferenceSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    '/api/files/../download',
    '/api/files/%2E%2E/download',
    '/api/files/file_1/download?token=secret',
    '/api/other/file_1/download',
    'javascript:alert(1)',
    'data:text/plain,secret',
    '',
  ])('rejects unsupported or unsafe report PDF references: %s', (value) => {
    expect(careReportPdfReferenceSchema.safeParse(value).success).toBe(false);
  });
});
