import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPhiSafePdfFileName,
  formatPdfDate,
  getPdfBranding,
  inferPdfPharmacyName,
  sanitizePdfFileName,
} from '@/server/services/pdf-rendering';

const { organizationFindUniqueMock, pharmacySiteFindFirstMock } = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    pharmacySite: {
      findFirst: pharmacySiteFindFirstMock,
    },
  },
}));

describe('pdf rendering utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats PDF dates and invalid values safely', () => {
    expect(formatPdfDate(new Date(2026, 3, 5))).toBe('2026/04/05');
    expect(formatPdfDate(new Date(2026, 3, 5, 9, 7), true)).toBe('2026/04/05 09:07');
    expect(formatPdfDate(null)).toBe('—');
    expect(formatPdfDate('not-a-date')).toBe('—');
  });

  it('sanitizes PDF filenames with a stable fallback', () => {
    expect(sanitizePdfFileName(' care-report 山田 太郎 / report_1.pdf ')).toBe(
      'care-report_report_1.pdf',
    );
    expect(sanitizePdfFileName('   ')).toBe('document');
  });

  it('builds PDF filenames from explicit safe segments only', () => {
    expect(buildPhiSafePdfFileName('visit-record', 20260405, 'record_1')).toBe(
      'visit-record-20260405-record_1.pdf',
    );
    expect(buildPhiSafePdfFileName('medication-calendar', 2026, '04.pdf')).toBe(
      'medication-calendar-2026-04.pdf',
    );
    expect(buildPhiSafePdfFileName(null, undefined, '')).toBe('document.pdf');
  });

  it('prefers site name over organization name for PDF branding', async () => {
    organizationFindUniqueMock.mockResolvedValue({ name: '組織薬局' });
    pharmacySiteFindFirstMock.mockResolvedValue({ name: '本店' });

    await expect(getPdfBranding('org_1')).resolves.toEqual({ pharmacyName: '本店' });

    expect(organizationFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'org_1' },
      select: { name: true },
    });
    expect(pharmacySiteFindFirstMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
      orderBy: { created_at: 'asc' },
      select: { name: true },
    });
  });

  it('falls back to organization or default pharmacy name', () => {
    expect(inferPdfPharmacyName('組織薬局', '  ')).toBe('組織薬局');
    expect(inferPdfPharmacyName(null, null)).toBe('PH-OS薬局');
  });
});
