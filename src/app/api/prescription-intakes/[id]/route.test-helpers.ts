import { NextRequest } from 'next/server';

export function createGetRequest() {
  return new NextRequest('http://localhost/api/prescription-intakes/intake_1', {
    method: 'GET',
  });
}

export function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/prescription-intakes/intake_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

export function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/prescription-intakes/intake_1', {
    method: 'PATCH',
    body: '{"original_collected_at":',
    headers: { 'content-type': 'application/json' },
  });
}

export function buildPhiRichPrescriptionIntake() {
  return {
    id: 'intake_phi_1',
    display_id: 'r0000000202',
    org_id: 'org_1',
    source_type: 'qr',
    lines: [
      {
        id: 'line_1',
        drug_name: 'アムロジピン錠5mg',
        dose: '1回1錠',
        days: 14,
        quantity: 14,
      },
    ],
    prescriber_institution_ref: {
      id: 'institution_1',
      name: 'みなとクリニック',
    },
    jahis_supplemental_records: [
      {
        id: 'jahis_1',
        payload: { patient_name: '山田 太郎', insurance_number: '12345678' },
        raw_line: 'JAHIS RAW 山田 太郎',
      },
    ],
    cycle: {
      display_id: 'mcyc0000000009',
      patient_id: 'patient_1',
      case_id: 'case_1',
      case_: {
        patient: {
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: '1950-01-01',
          gender: 'male',
        },
      },
      inquiries: [
        {
          id: 'inquiry_1',
          inquiry_content: '服用タイミングを確認',
          change_detail: '朝食後へ変更',
        },
      ],
    },
  };
}

export function buildPrescriptionIntakeFixture(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    org_id: 'org_1',
    source_type: 'fax',
    cycle: {
      patient_id: 'patient_1',
      case_id: 'case_1',
    },
    ...overrides,
  };
}
