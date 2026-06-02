import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  renderToBufferMock,
  fontRegisterMock,
  organizationFindUniqueMock,
  pharmacySiteFindFirstMock,
  careReportFindFirstMock,
  patientFindFirstMock,
} = vi.hoisted(() => ({
  renderToBufferMock: vi.fn(),
  fontRegisterMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
}));

vi.mock('@react-pdf/renderer', async () => {
  const React = await import('react');
  const Component = (props: { children?: React.ReactNode }) =>
    React.createElement('div', null, props.children);
  return {
    Document: Component,
    Font: { register: fontRegisterMock },
    Page: Component,
    StyleSheet: { create: (styles: unknown) => styles },
    Text: Component,
    View: Component,
    renderToBuffer: renderToBufferMock,
  };
});

vi.mock('@/lib/db/client', () => ({
  prisma: {
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    pharmacySite: {
      findFirst: pharmacySiteFindFirstMock,
    },
    careReport: {
      findFirst: careReportFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

import { buildCareReportPdf } from './pdf-documents';

const baseReport = {
  id: 'report_1',
  patient_id: 'patient_1',
  case_id: null,
  visit_record_id: null,
  status: 'draft',
  created_at: new Date('2026-04-01T00:00:00.000Z'),
  updated_at: new Date('2026-04-01T00:00:00.000Z'),
};

describe('buildCareReportPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from('pdf'));
    organizationFindUniqueMock.mockResolvedValue({ name: 'ケアビア薬局' });
    pharmacySiteFindFirstMock.mockResolvedValue({ name: '本店' });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      gender: 'male',
    });
  });

  it('falls back to generic content rendering for malformed physician-report JSON', async () => {
    careReportFindFirstMock.mockResolvedValue({
      ...baseReport,
      report_type: 'physician_report',
      content: {
        patient: ['unexpected'],
        prescriptions: 'not-an-array',
        billing_context: { payer_basis: 'medical' },
      },
    });

    const result = await buildCareReportPdf('org_1', 'report_1');

    expect(result.fileName).toBe('care-report-_-report_1.pdf');
    expect(result.buffer).toEqual(Buffer.from('pdf'));
    expect(renderToBufferMock).toHaveBeenCalledOnce();
  });

  it('falls back to generic content rendering for malformed care-manager-report JSON', async () => {
    careReportFindFirstMock.mockResolvedValue({
      ...baseReport,
      report_type: 'care_manager_report',
      content: {
        patient: null,
        medication_management_summary: { total_drugs: '5' },
      },
    });

    const result = await buildCareReportPdf('org_1', 'report_1');

    expect(result.fileName).toBe('care-report-_-report_1.pdf');
    expect(result.buffer).toEqual(Buffer.from('pdf'));
    expect(renderToBufferMock).toHaveBeenCalledOnce();
  });
});
