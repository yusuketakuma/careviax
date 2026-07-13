import { describe, expect, it } from 'vitest';
import {
  buildCaseRiskCockpitResponseSchema,
  buildCaseRiskTaskResolutionResponseSchema,
  buildCaseRiskTaskSyncResponseSchema,
  buildPatientDocumentsResponseSchema,
  buildPatientHeaderSummaryResponseSchema,
  patientHomeOperationsResponseSchema,
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

  it('validates case risk identity and aggregate counts', () => {
    const response = {
      data: {
        generated_at: '2026-07-13T00:00:00.000Z',
        patient: { id: 'patient_1', display_id: null, name: '患者 太郎' },
        case: { id: 'case_1', display_id: null, status: 'active' },
        overall: {
          status: 'blocked',
          blocking_count: 1,
          urgent_count: 0,
          warning_count: 0,
        },
        sections: [
          {
            domain: 'medication',
            label: '薬剤リスク',
            status: 'blocked',
            findings: [
              {
                key: 'stock',
                domain: 'medication',
                severity: 'blocking',
                title: '残薬確認',
                detail: '残薬確認が必要です。',
                patient_id: 'patient_1',
                case_id: 'case_1',
                action_href: '/patients/patient_1',
                action_label: '確認する',
                resolution_state: 'open',
                source: 'computed',
              },
            ],
          },
        ],
        next_actions: [],
      },
    };
    const schema = buildCaseRiskCockpitResponseSchema('case_1');
    expect(schema.safeParse(response).success).toBe(true);
    response.data.overall.blocking_count = 0;
    expect(schema.safeParse(response).success).toBe(false);
    response.data.overall.blocking_count = 1;
    response.data.sections[0]!.findings[0]!.case_id = 'case_2';
    expect(schema.safeParse(response).success).toBe(false);
  });

  it('validates risk task sync counts and strips task refs', () => {
    const response = {
      data: {
        generated_at: '2026-07-13T00:00:00.000Z',
        case_id: 'case_1',
        patient_id: 'patient_1',
        overall_status: 'attention',
        taskable_finding_count: 1,
        skipped_finding_count: 0,
        upserted_task_count: 1,
        upserted_tasks: [{ id: 'task_1', display_id: null }],
        resolved_stale_task_count: 0,
        resolved_stale_tasks: [],
      },
    };
    const parsed = buildCaseRiskTaskSyncResponseSchema('case_1', 'patient_1').safeParse(response);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('risk task sync response should parse');
    expect(parsed.data.data).not.toHaveProperty('upserted_tasks');
    response.data.upserted_task_count = 2;
    expect(
      buildCaseRiskTaskSyncResponseSchema('case_1', 'patient_1').safeParse(response).success,
    ).toBe(false);
  });

  it('validates the five home operation domains and alert relations', () => {
    const items = ['documents', 'mcs', 'prescription', 'billing', 'conference'].map((key) => ({
      key,
      label: key,
      status: '確認済み',
      description: '状態を確認します。',
      href: `/patients/patient_1#patient-${key}`,
      action_label: '確認する',
      tone: key === 'documents' ? 'attention' : 'ok',
      updated_at: null,
      metrics: [],
      alerts: key === 'documents' ? ['未回収'] : [],
    }));
    const response = {
      data: {
        generated_at: '2026-07-13T00:00:00.000Z',
        attention_count: 1,
        top_alerts: [
          {
            id: 'documents:0:未回収',
            key: 'documents',
            label: 'documents',
            message: '未回収',
            href: '/patients/patient_1#patient-documents',
            action_label: '確認する',
          },
        ],
        items,
      },
    };
    expect(patientHomeOperationsResponseSchema.safeParse(response).success).toBe(true);
    response.data.attention_count = 0;
    expect(patientHomeOperationsResponseSchema.safeParse(response).success).toBe(false);
    response.data.attention_count = 1;
    response.data.top_alerts[0]!.message = '存在しない警告';
    expect(patientHomeOperationsResponseSchema.safeParse(response).success).toBe(false);
  });

  it('requires the requested risk task resolution and audited single update', () => {
    const response = {
      data: {
        task_id: 'task_1',
        display_id: null,
        case_id: 'case_1',
        resolution_state: 'waived',
        task_status: 'cancelled',
        updated_count: 1,
        audit_logged: true,
      },
    };
    const schema = buildCaseRiskTaskResolutionResponseSchema('case_1', 'task_1');
    expect(schema.safeParse(response).success).toBe(true);
    response.data.updated_count = 0;
    expect(schema.safeParse(response).success).toBe(false);
  });
});
