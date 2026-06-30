import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';

const {
  renderToBufferMock,
  fontRegisterMock,
  organizationFindUniqueMock,
  pharmacySiteFindFirstMock,
  billingCandidateFindFirstMock,
  careReportFindFirstMock,
  patientFindFirstMock,
  medicationProfileFindManyMock,
  visitRecordFindManyMock,
} = vi.hoisted(() => ({
  renderToBufferMock: vi.fn(),
  fontRegisterMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  billingCandidateFindFirstMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  medicationProfileFindManyMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
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
    billingCandidate: {
      findFirst: billingCandidateFindFirstMock,
    },
    careReport: {
      findFirst: careReportFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    medicationProfile: {
      findMany: medicationProfileFindManyMock,
    },
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
  },
}));

import {
  buildBillingDocumentPdf,
  buildCareReportPdf,
  buildMedicationCalendarPdf,
  buildMedicationHistoryPdf,
  buildPatientVisitRecordsPdf,
} from './pdf-documents';
import { PdfNotFoundError } from './pdf-errors';

function collectPdfText(value: unknown): string[] {
  if (value == null || typeof value === 'boolean') return [];
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectPdfText);
  if (!isValidElement(value)) return [];

  const props = value.props as {
    title?: unknown;
    subtitle?: unknown;
    pharmacyName?: unknown;
    children?: unknown;
    rows?: unknown;
    items?: unknown;
    headers?: unknown;
  };
  const rows = Array.isArray(props.rows)
    ? props.rows.flatMap((row) => {
        if (Array.isArray(row)) return row;
        if (row && typeof row === 'object') {
          const record = row as { label?: unknown; value?: unknown };
          return [record.label, record.value];
        }
        return [];
      })
    : [];

  return [
    ...collectPdfText(props.title),
    ...collectPdfText(props.subtitle),
    ...collectPdfText(props.pharmacyName),
    ...collectPdfText(props.headers),
    ...collectPdfText(rows),
    ...collectPdfText(props.items),
    ...collectPdfText(props.children),
  ];
}

const baseReport = {
  id: 'report_1',
  patient_id: 'patient_1',
  case_id: null,
  visit_record_id: null,
  status: 'confirmed',
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
      archived_at: null,
    });
    medicationProfileFindManyMock.mockResolvedValue([]);
    visitRecordFindManyMock.mockResolvedValue([]);
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

    expect(result.fileName).toBe('care-report-report_1.pdf');
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

    expect(result.fileName).toBe('care-report-report_1.pdf');
    expect(result.buffer).toEqual(Buffer.from('pdf'));
    expect(renderToBufferMock).toHaveBeenCalledOnce();
  });

  it('renders physician report medication-safety sections without internal billing context', async () => {
    careReportFindFirstMock.mockResolvedValue({
      ...baseReport,
      report_type: 'physician_report',
      content: {
        patient: { name: '山田 太郎', birth_date: '1940-01-01', gender: 'male' },
        report_date: '2026-06-15',
        visit_date: '2026-06-14',
        pharmacist_name: '鈴木 薬剤師',
        prescriber: { name: '佐藤 医師', institution: '在宅クリニック' },
        prescriptions: [
          { drug_name: 'アムロジピン錠5mg', dose: '1錠', frequency: '朝食後', days: 14 },
        ],
        medication_management: {
          compliance_summary: '全量服用。',
          adherence_score: 5,
          self_management: '支援あり',
          calendar_used: true,
        },
        adverse_events: {
          has_events: true,
          events: ['ふらつき'],
          details: '降圧薬調整を相談。',
        },
        functional_assessment: {
          lab_values: 'eGFR 42',
          sleep: '問題なし',
          cognition: '問題なし',
          diet_oral: '問題なし',
          mobility: 'ふらつきあり',
          excretion: '問題なし',
        },
        residual_medications: [],
        assessment: '薬剤性ふらつきの可能性。',
        plan: '処方医へ共有。',
        prescription_proposals: '降圧薬の減量検討。',
        physician_communication: 'ふらつきについて処方調整をご検討ください。',
        warnings: [],
        billing_context: {
          billing_evidence_id: 'billing-1',
          payer_basis: 'medical',
          jahis_supplemental_record_count: 2,
        },
      },
    });

    await buildCareReportPdf('org_1', 'report_1');

    const text = collectPdfText(renderToBufferMock.mock.calls[0][0]).join('\n');
    expect(text).toContain('薬物有害事象');
    expect(text).toContain('検査値・機能評価');
    expect(text).toContain('eGFR 42');
    expect(text).toContain('処方医への連絡事項');
    expect(text).not.toContain('請求コンテキスト');
    expect(text).not.toContain('JAHIS');
    expect(text).not.toContain('billing-1');
  });

  it('renders older physician report content safely without raw JSON fallback', async () => {
    careReportFindFirstMock.mockResolvedValue({
      ...baseReport,
      report_type: 'physician_report',
      content: {
        patient: { name: '山田 太郎', birth_date: '1940-01-01', gender: 'male' },
        report_date: '2026-06-15',
        visit_date: '2026-06-14',
        pharmacist_name: '鈴木 薬剤師',
        prescriber: { name: '佐藤 医師', institution: '在宅クリニック' },
        prescriptions: [
          { drug_name: 'アムロジピン錠5mg', dose: '1錠', frequency: '朝食後', days: 14 },
        ],
        medication_management: {
          compliance_summary: '全量服用。',
          adherence_score: 5,
          self_management: '支援あり',
          calendar_used: true,
        },
        residual_medications: [],
        assessment: '服薬管理は安定。',
        plan: '服薬指導を継続。',
        warnings: [],
        source_provenance: { patient_id: 'patient_1' },
      },
    });

    await buildCareReportPdf('org_1', 'report_1');

    const text = collectPdfText(renderToBufferMock.mock.calls[0][0]).join('\n');
    expect(text).toContain('アムロジピン錠5mg');
    expect(text).toContain('服薬管理は安定。');
    expect(text).toContain('記載なし');
    expect(text).toContain('特になし');
    expect(text).not.toContain('外部提出用PDFとして表示できません');
    expect(text).not.toContain('source_provenance');
    expect(text).not.toContain('patient_1');
  });

  it('renders archived-patient state in care report PDFs without internal archive ownership', async () => {
    patientFindFirstMock.mockResolvedValueOnce({
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      gender: 'male',
      archived_at: new Date(2026, 5, 30, 9, 0),
      archived_by: 'internal_user',
    });
    careReportFindFirstMock.mockResolvedValue({
      ...baseReport,
      report_type: 'physician_report',
      content: {
        patient: { name: '山田 太郎', birth_date: '1940-01-01', gender: 'male' },
        report_date: '2026-06-15',
        visit_date: '2026-06-14',
        pharmacist_name: '鈴木 薬剤師',
        prescriber: { name: '佐藤 医師', institution: '在宅クリニック' },
        prescriptions: [
          { drug_name: 'アムロジピン錠5mg', dose: '1錠', frequency: '朝食後', days: 14 },
        ],
        medication_management: {
          compliance_summary: '全量服用。',
          adherence_score: 5,
          self_management: '支援あり',
          calendar_used: true,
        },
        residual_medications: [],
        assessment: '服薬管理は安定。',
        plan: '服薬指導を継続。',
        warnings: [],
      },
    });

    await buildCareReportPdf('org_1', 'report_1');

    const text = collectPdfText(renderToBufferMock.mock.calls[0][0]).join('\n');
    expect(text).toContain('患者状態');
    expect(text).toContain('アーカイブ中（閲覧専用）');
    expect(text).toContain('アーカイブ日時');
    expect(text).toContain('2026/06/30');
    expect(text).not.toContain('archived_by');
    expect(text).not.toContain('internal_user');
  });

  it('renders nurse share PDFs from an external allowlist and hides provenance keys', async () => {
    careReportFindFirstMock.mockResolvedValue({
      ...baseReport,
      report_type: 'nurse_share',
      content: {
        report_audience: 'visiting_nurse',
        patient: { name: '山田 太郎', birth_date: '1940-01-01' },
        report_date: '2026-06-15',
        visit_date: '2026-06-14',
        pharmacist_name: '鈴木 薬剤師',
        summary: '眠気とふらつきを確認。',
        medication: '服薬状況: 全量服用。',
        residual: '残薬なし。',
        evaluation: '転倒リスクに注意。',
        requests: '症状変化の観察をお願いします。',
        warnings: [],
        billing_context: { billing_evidence_id: 'billing-1' },
        source_provenance: {
          patient_id: 'patient_1',
          visit_record_id: 'visit_1',
          prescription_line_ids: ['line-1'],
          prescription_lines: [{ drug_code: '123456789', prescription_line_id: 'line-1' }],
        },
      },
    });

    await buildCareReportPdf('org_1', 'report_1');

    const text = collectPdfText(renderToBufferMock.mock.calls[0][0]).join('\n');
    expect(text).toContain('今日の要点');
    expect(text).toContain('服薬状況');
    expect(text).toContain('お願いしたいこと');
    expect(text).toContain('症状変化の観察をお願いします。');
    expect(text).not.toContain('source_provenance');
    expect(text).not.toContain('patient_id');
    expect(text).not.toContain('visit_1');
    expect(text).not.toContain('line-1');
    expect(text).not.toContain('123456789');
    expect(text).not.toContain('billing-1');
  });

  it('renders family share PDFs from the audience allowlist and hides internal provenance', async () => {
    careReportFindFirstMock.mockResolvedValue({
      ...baseReport,
      report_type: 'family_share',
      content: {
        report_audience: 'family',
        patient: { name: '山田 太郎', birth_date: '1940-01-01' },
        report_date: '2026-06-15',
        visit_date: '2026-06-14',
        pharmacist_name: '鈴木 薬剤師',
        summary: '眠気は落ち着いています。',
        medication: '朝食後の薬は家族確認で服用できています。',
        residual: '残薬はありません。',
        evaluation: '転倒リスクは低下傾向です。',
        requests: 'ふらつきが出たら薬局へ連絡してください。',
        warnings: ['眠気が強い日は運転を避けてください。'],
        billing_context: { billing_evidence_id: 'billing-1' },
        source_provenance: {
          patient_id: 'patient_1',
          visit_record_id: 'visit_1',
          prescription_line_ids: ['line-1'],
          prescription_lines: [{ drug_code: '123456789', prescription_line_id: 'line-1' }],
        },
      },
    });

    await buildCareReportPdf('org_1', 'report_1');

    const text = collectPdfText(renderToBufferMock.mock.calls[0][0]).join('\n');
    expect(text).toContain('ご家族向け服薬情報共有');
    expect(text).toContain('眠気は落ち着いています。');
    expect(text).toContain('朝食後の薬は家族確認で服用できています。');
    expect(text).toContain('ふらつきが出たら薬局へ連絡してください。');
    expect(text).toContain('眠気が強い日は運転を避けてください。');
    expect(text).not.toContain('source_provenance');
    expect(text).not.toContain('patient_id');
    expect(text).not.toContain('visit_1');
    expect(text).not.toContain('line-1');
    expect(text).not.toContain('123456789');
    expect(text).not.toContain('billing-1');
  });

  it('does not render audience report PDFs when report type and audience disagree', async () => {
    careReportFindFirstMock.mockResolvedValue({
      ...baseReport,
      report_type: 'nurse_share',
      content: {
        report_audience: 'facility',
        patient: { name: '山田 太郎', birth_date: '1940-01-01' },
        report_date: '2026-06-15',
        visit_date: '2026-06-14',
        pharmacist_name: '鈴木 薬剤師',
        summary: '施設向け要点。',
        medication: '施設向け服薬状況。',
        residual: '残薬なし。',
        evaluation: '施設向け評価。',
        requests: '施設向け依頼。',
        warnings: [],
      },
    });

    await buildCareReportPdf('org_1', 'report_1');

    const text = collectPdfText(renderToBufferMock.mock.calls[0][0]).join('\n');
    expect(text).toContain('外部提出用PDFとして表示できません');
    expect(text).not.toContain('施設向け服薬状況。');
    expect(text).not.toContain('施設向け依頼。');
  });
});

describe('buildBillingDocumentPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from('pdf'));
    organizationFindUniqueMock.mockResolvedValue({ name: 'ケアビア薬局' });
    pharmacySiteFindFirstMock.mockResolvedValue({ name: '本店' });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
    });
    billingCandidateFindFirstMock.mockResolvedValue({
      id: 'candidate_1',
      patient_id: 'patient_1',
      billing_domain: 'home_care',
      billing_target_name: null,
      billing_month: new Date('2026-06-01T00:00:00.000Z'),
      billing_code: 'HC-001',
      billing_name: '居宅療養管理指導',
      source_snapshot: null,
      calculation_breakdown: {
        collection: {
          status: 'collected',
          billed_amount: 3240,
          collected_amount: 3240,
          unpaid_amount: 0,
          payment_method: 'cash',
          payer_name: '長女',
          collected_at: '2026-06-16T01:00:00.000Z',
          receipt_number: 'R20260616-001',
          receipt_issue_status: 'issued',
          invoice_issue_status: 'issued',
          receipt_copy_url: '/api/billing-candidates/candidate_1/documents/pdf?kind=receipt',
          invoice_copy_url: '/api/billing-candidates/candidate_1/documents/pdf?kind=invoice',
          updated_at: '2026-06-16T01:00:00.000Z',
        },
      },
    });
  });

  it('renders receipt information from the billing collection snapshot', async () => {
    const result = await buildBillingDocumentPdf('org_1', 'candidate_1', 'receipt');

    expect(result.fileName).toBe('billing-receipt-_-candidate_1.pdf');
    expect(result.buffer).toEqual(Buffer.from('pdf'));
    const text = collectPdfText(renderToBufferMock.mock.calls[0][0]).join('\n');
    expect(text).toContain('領収証');
    expect(text).toContain('R20260616-001');
    expect(text).toContain('山田 太郎');
    expect(text).toContain('居宅療養管理指導');
    expect(text).toContain('3,240円');
  });

  it('rejects issued receipt exports when the collected amount is not positive', async () => {
    billingCandidateFindFirstMock.mockResolvedValueOnce({
      id: 'candidate_1',
      patient_id: 'patient_1',
      billing_domain: 'home_care',
      billing_target_name: null,
      billing_month: new Date('2026-06-01T00:00:00.000Z'),
      billing_code: 'HC-001',
      billing_name: '居宅療養管理指導',
      source_snapshot: null,
      calculation_breakdown: {
        collection: {
          status: 'collected',
          billed_amount: 3240,
          collected_amount: 0,
          unpaid_amount: 3240,
          receipt_number: 'R20260616-001',
          receipt_issue_status: 'issued',
          invoice_issue_status: 'issued',
        },
      },
    });

    await expect(buildBillingDocumentPdf('org_1', 'candidate_1', 'receipt')).rejects.toThrow(
      'BILLING_DOCUMENT_NOT_ISSUED',
    );
    expect(renderToBufferMock).not.toHaveBeenCalled();
  });

  it('rejects issued invoice exports when the billed amount is not positive', async () => {
    billingCandidateFindFirstMock.mockResolvedValueOnce({
      id: 'candidate_1',
      patient_id: 'patient_1',
      billing_domain: 'home_care',
      billing_target_name: null,
      billing_month: new Date('2026-06-01T00:00:00.000Z'),
      billing_code: 'HC-001',
      billing_name: '居宅療養管理指導',
      source_snapshot: null,
      calculation_breakdown: {
        collection: {
          status: 'billed',
          billed_amount: 0,
          collected_amount: 0,
          unpaid_amount: 0,
          invoice_issue_status: 'issued',
        },
      },
    });

    await expect(buildBillingDocumentPdf('org_1', 'candidate_1', 'invoice')).rejects.toThrow(
      'BILLING_DOCUMENT_NOT_ISSUED',
    );
    expect(renderToBufferMock).not.toHaveBeenCalled();
  });

  it('rejects unissued invoice exports', async () => {
    billingCandidateFindFirstMock.mockResolvedValueOnce({
      id: 'candidate_1',
      patient_id: 'patient_1',
      billing_domain: 'home_care',
      billing_target_name: null,
      billing_month: new Date('2026-06-01T00:00:00.000Z'),
      billing_code: 'HC-001',
      billing_name: '居宅療養管理指導',
      source_snapshot: null,
      calculation_breakdown: {
        collection: {
          status: 'billed',
          billed_amount: 3240,
          collected_amount: 0,
          unpaid_amount: 3240,
          invoice_issue_status: 'not_issued',
        },
      },
    });

    await expect(buildBillingDocumentPdf('org_1', 'candidate_1', 'invoice')).rejects.toThrow(
      'BILLING_DOCUMENT_NOT_ISSUED',
    );
    expect(renderToBufferMock).not.toHaveBeenCalled();
  });
});

describe('buildPatientVisitRecordsPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from('pdf'));
    organizationFindUniqueMock.mockResolvedValue({ name: 'ケアビア薬局' });
    pharmacySiteFindFirstMock.mockResolvedValue({ name: '本店' });
  });

  it('does not query visit records when patient access is denied', async () => {
    patientFindFirstMock.mockResolvedValue(null);
    visitRecordFindManyMock.mockResolvedValue([]);

    await expect(buildPatientVisitRecordsPdf('org_1', 'patient_1')).rejects.toBeInstanceOf(
      PdfNotFoundError,
    );

    expect(patientFindFirstMock).toHaveBeenCalledOnce();
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
    expect(renderToBufferMock).not.toHaveBeenCalled();
  });
});

describe('buildMedicationHistoryPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from('pdf'));
    organizationFindUniqueMock.mockResolvedValue({ name: 'ケアビア薬局' });
    pharmacySiteFindFirstMock.mockResolvedValue({ name: '本店' });
  });

  it('does not query medication profiles when patient access is denied', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    await expect(buildMedicationHistoryPdf('org_1', 'patient_1')).rejects.toBeInstanceOf(
      PdfNotFoundError,
    );

    expect(patientFindFirstMock).toHaveBeenCalledOnce();
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(renderToBufferMock).not.toHaveBeenCalled();
  });

  it('renders archived-patient state in medication history PDFs', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      gender: 'male',
      archived_at: new Date(2026, 5, 30, 9, 0),
      archived_by: 'internal_user',
    });
    medicationProfileFindManyMock.mockResolvedValue([]);

    const result = await buildMedicationHistoryPdf('org_1', 'patient_1');

    expect(result.fileName).toBe('medications-_-patient_1.pdf');
    const text = collectPdfText(renderToBufferMock.mock.calls[0][0]).join('\n');
    expect(text).toContain('患者状態');
    expect(text).toContain('アーカイブ中（閲覧専用）');
    expect(text).toContain('2026/06/30');
    expect(text).not.toContain('archived_by');
    expect(text).not.toContain('internal_user');
  });
});

describe('buildMedicationCalendarPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from('pdf'));
    organizationFindUniqueMock.mockResolvedValue({ name: 'ケアビア薬局' });
    pharmacySiteFindFirstMock.mockResolvedValue({ name: '本店' });
  });

  it('does not query medication profiles when patient access is denied', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    await expect(
      buildMedicationCalendarPdf('org_1', 'patient_1', '2026-04'),
    ).rejects.toBeInstanceOf(PdfNotFoundError);

    expect(patientFindFirstMock).toHaveBeenCalledOnce();
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(renderToBufferMock).not.toHaveBeenCalled();
  });
});
