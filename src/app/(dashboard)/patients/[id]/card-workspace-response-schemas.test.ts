import { describe, expect, it } from 'vitest';
import {
  buildPatientDocumentsResponseSchema,
  buildPatientHeaderSummaryResponseSchema,
} from './card-workspace-response-schemas';

function documentsResponse(patientId = 'patient_1') {
  return {
    data: {
      patient: { id: patientId, name: '患者 太郎', name_kana: 'カンジャ タロウ' },
      print_readiness: {
        overall_status: 'blocked',
        missing_required_count: 1,
        warning_count: 0,
        template_versions: [],
        checks: [
          {
            key: 'patient_profile',
            label: '患者基本情報',
            completed: false,
            severity: 'required',
            description: '基本情報を登録してください。',
            action_href: `/patients/${patientId}/edit`,
            action_label: '基本情報を編集',
          },
        ],
      },
      document_statuses: [],
      first_visit_documents: [],
    },
  };
}

function headerSummaryResponse(patientId = 'patient_1') {
  return {
    data: {
      patient_id: patientId,
      name: '患者 太郎',
      name_kana: 'カンジャ タロウ',
      birth_date: '1940-01-01T00:00:00.000Z',
      gender: 'male',
      gender_label: '男性',
      care_level: null,
      care_level_label: null,
      home_status_label: null,
      residence_label: null,
      primary_diagnosis: null,
      intervention_start_date: null,
      primary_pharmacist_name: null,
      backup_pharmacist_name: null,
      primary_staff_name: null,
      backup_staff_name: null,
      first_visit_date: null,
      last_prescribed_date: null,
      next_prescription_expected_date: null,
      safety: {
        allergy: null,
        renal: null,
        handling_tags: [],
        swallowing: null,
        cautions: [],
        safety_tags: ['allergy', 'renal'],
        visible_safety_tags: ['allergy'],
        hidden_safety_tag_count: 1,
      },
    },
  };
}

describe('card workspace response schemas', () => {
  it('accepts the provider document and header summary shapes', () => {
    expect(
      buildPatientDocumentsResponseSchema('patient_1').safeParse(documentsResponse()).success,
    ).toBe(true);
    expect(
      buildPatientHeaderSummaryResponseSchema('patient_1').safeParse(headerSummaryResponse())
        .success,
    ).toBe(true);
  });

  it('rejects cross-patient document and header summary responses', () => {
    expect(
      buildPatientDocumentsResponseSchema('patient_1').safeParse(documentsResponse('patient_2'))
        .success,
    ).toBe(false);
    expect(
      buildPatientHeaderSummaryResponseSchema('patient_1').safeParse(
        headerSummaryResponse('patient_2'),
      ).success,
    ).toBe(false);
  });

  it('rejects inconsistent document readiness counts', () => {
    const response = documentsResponse();
    response.data.print_readiness.missing_required_count = 0;
    expect(buildPatientDocumentsResponseSchema('patient_1').safeParse(response).success).toBe(
      false,
    );
  });

  it('rejects inconsistent safety tag projections', () => {
    const response = headerSummaryResponse();
    response.data.safety.hidden_safety_tag_count = 0;
    expect(buildPatientHeaderSummaryResponseSchema('patient_1').safeParse(response).success).toBe(
      false,
    );
  });
});
