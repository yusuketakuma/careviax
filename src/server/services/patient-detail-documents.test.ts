import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

const getPatientRiskSummaryMock = vi.hoisted(() => vi.fn());
const getPatientVisitBriefMock = vi.hoisted(() => vi.fn());
const getPatientHomeCareFeatureSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/patient-risk', () => ({
  getPatientRiskSummary: getPatientRiskSummaryMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getPatientVisitBrief: getPatientVisitBriefMock,
}));

vi.mock('@/server/services/home-care-ops', () => ({
  getPatientHomeCareFeatureSummary: getPatientHomeCareFeatureSummaryMock,
}));

import { getPatientDocumentsData } from './patient-detail';
import { buildDb } from './patient-detail.test-support';

beforeEach(() => {
  vi.clearAllMocks();
  getPatientRiskSummaryMock.mockResolvedValue({
    level: 'low',
    score: 0,
    factors: [],
  });
  getPatientVisitBriefMock.mockResolvedValue(null);
  getPatientHomeCareFeatureSummaryMock.mockResolvedValue({
    states: [],
    highlights: [],
  });
});

describe('getPatientDocumentsData', () => {
  it('normalizes object-shaped first-visit emergency contacts and ignores malformed items', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: new Date('1940-01-01T00:00:00.000Z'),
          phone: '03-0000-0000',
          medical_insurance_number: null,
          care_insurance_number: 'CARE123456',
          residences: [
            {
              address: '東京都千代田区1-1-1',
              facility_id: null,
              building_id: null,
              unit_name: null,
              is_primary: true,
            },
          ],
          contacts: [
            {
              name: '山田 花子',
              phone: '03-1111-1111',
              is_primary: true,
              is_emergency_contact: true,
            },
          ],
          insurances: [],
          cases: [
            {
              id: 'case_1',
              status: 'active',
              start_date: new Date('2026-04-01T00:00:00.000Z'),
              primary_pharmacist_id: 'user_1',
            },
          ],
        }),
      },
      template: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'template_contract',
            template_type: 'contract_document',
            name: '居宅療養管理指導契約書 2026年版',
            version: 2,
            effective_from: new Date('2026-04-01T00:00:00.000Z'),
            effective_to: null,
          },
          {
            id: 'template_important',
            template_type: 'important_matters',
            name: '重要事項説明書 2026年版',
            version: 1,
            effective_from: new Date('2026-04-01T00:00:00.000Z'),
            effective_to: null,
          },
          {
            id: 'template_privacy',
            template_type: 'privacy_consent',
            name: '個人情報同意書 2026年版',
            version: 1,
            effective_from: new Date('2026-04-01T00:00:00.000Z'),
            effective_to: null,
          },
          {
            id: 'template_consent',
            template_type: 'consent_form',
            name: '在宅サービス同意書 2026年版',
            version: 1,
            effective_from: new Date('2026-04-01T00:00:00.000Z'),
            effective_to: null,
          },
        ]),
      },
      firstVisitDocument: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'doc_1',
            case_id: 'case_1',
            document_url: null,
            delivered_at: null,
            delivered_to: null,
            created_at: new Date('2026-04-01T00:00:00.000Z'),
            updated_at: new Date('2026-04-01T00:00:00.000Z'),
            emergency_contacts: [
              ['unexpected'],
              { relation: '長女' },
              {
                id: 'contact_1',
                name: '山田 花子',
                relation: '長女',
                phone: '03-0000-0000',
                email: 'hanako@example.test',
                fax: null,
                organization_name: '山田家',
                department: '家族',
                is_primary: true,
                is_emergency_contact: true,
              },
            ],
          },
        ]),
      },
      // per-document 履歴は raw SQL window query 経由。$queryRaw が window の結果(<=5/文書)を返す。
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'audit_1',
          actor_id: 'user_1',
          action: 'first_visit_document.replaced',
          target_id: 'doc_1',
          changes: {
            document_action: {
              action: 'replaced',
              document_type: 'contract',
              template_name: '居宅療養管理指導契約書 2026年版',
              template_version: 'v1.1',
              storage_location: 'store',
              contract_date: '2026-06-10',
              explanation_date: '2026-06-10',
              explanation_staff_name: '佐藤薬剤師',
              signer_type: 'family',
              signer_name: '山田 花子',
              signer_relationship: '長女',
              reason: '署名者を長女へ訂正',
              note: '本人同席',
            },
          },
          created_at: new Date('2026-06-17T00:00:00.000Z'),
        },
        {
          id: 'audit_print_1',
          actor_id: 'user_1',
          action: 'first_visit_document.printed',
          target_id: 'doc_1',
          changes: {
            document_action: {
              action: 'printed',
              document_type: 'contract',
              template_name: '居宅療養管理指導契約書 2026年版',
              template_version: 'v1.1',
              print_batch_id: 'print_20260616T013000Z_batch1',
              storage_location: 'store',
              note: '印刷ハブから一括印刷',
            },
          },
          created_at: new Date('2026-06-16T00:00:00.000Z'),
        },
      ]),
    });

    const result = await getPatientDocumentsData(
      db as unknown as Parameters<typeof getPatientDocumentsData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      },
    );

    // teeth: per-document 履歴は ROW_NUMBER() window query で文書ごと直近5件に bound する。
    // グローバル take:30 へ戻すと文書数が多いとき一部文書の履歴が欠落するため、query 構造を pin。
    const queryRawMock = db.$queryRaw as ReturnType<typeof vi.fn>;
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const querySql = (queryRawMock.mock.calls[0][0] as string[]).join('?');
    expect(querySql).toContain(
      'ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY created_at DESC)',
    );
    // cap は厳密に 5(rn <= 50 等の緩みを弾く word-boundary)。
    expect(querySql).toMatch(/rn\s*<=\s*5\b/);
    expect(querySql).toContain("target_type = 'first_visit_document'");
    // org_id 述語を SQL テキストでも pin(bind 値の位置照合と二重で tenant scope を担保)。
    expect(querySql).toContain('org_id = ');
    // bind 変数(injection 不可): org_id と documentIds 配列。
    const queryValues = queryRawMock.mock.calls[0].slice(1);
    expect(queryValues[0]).toBe('org_1');
    expect(queryValues[1]).toEqual(expect.arrayContaining(['doc_1']));

    expect(result?.patient).toEqual({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
    });
    expect(result?.print_readiness).toMatchObject({
      overall_status: 'ready',
      missing_required_count: 0,
      warning_count: 0,
      template_versions: expect.arrayContaining([
        expect.objectContaining({
          document_type: 'contract',
          label: '契約書',
          template_id: 'template_contract',
          template_name: '居宅療養管理指導契約書 2026年版',
          template_version: 'v2',
          effective_from: new Date('2026-04-01T00:00:00.000Z'),
          effective_to: null,
        }),
      ]),
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: 'default_templates',
          completed: true,
          severity: 'required',
        }),
      ]),
    });
    expect(result?.first_visit_documents[0]?.emergency_contacts).toEqual([
      {
        id: 'contact_1',
        name: '山田 花子',
        relation: '長女',
        phone: '03-0000-0000',
        email: 'hanako@example.test',
        fax: null,
        organization_name: '山田家',
        department: '家族',
        is_primary: true,
        is_emergency_contact: true,
      },
    ]);
    expect(result?.first_visit_documents[0]?.history).toEqual([
      {
        id: 'audit_1',
        action: 'replaced',
        document_type: 'contract',
        template_name: '居宅療養管理指導契約書 2026年版',
        template_version: 'v1.1',
        print_batch_id: null,
        storage_location: 'store',
        contract_date: '2026-06-10',
        explanation_date: '2026-06-10',
        explanation_staff_name: '佐藤薬剤師',
        signer_type: 'family',
        signer_name: '山田 花子',
        signer_relationship: '長女',
        reason: '署名者を長女へ訂正',
        note: '本人同席',
        actor_id: 'user_1',
        created_at: new Date('2026-06-17T00:00:00.000Z'),
      },
      {
        id: 'audit_print_1',
        action: 'printed',
        document_type: 'contract',
        template_name: '居宅療養管理指導契約書 2026年版',
        template_version: 'v1.1',
        print_batch_id: 'print_20260616T013000Z_batch1',
        storage_location: 'store',
        contract_date: null,
        explanation_date: null,
        explanation_staff_name: null,
        signer_type: null,
        signer_name: null,
        signer_relationship: null,
        reason: null,
        note: '印刷ハブから一括印刷',
        actor_id: 'user_1',
        created_at: new Date('2026-06-16T00:00:00.000Z'),
      },
    ]);
    expect(result?.document_statuses).toEqual(
      expect.arrayContaining([
        {
          document_type: 'contract',
          label: '契約書',
          status: 'replaced',
          status_label: '差替え済み',
          template_name: '居宅療養管理指導契約書 2026年版',
          template_version: 'v1.1',
          storage_location: 'store',
          latest_action_at: new Date('2026-06-17T00:00:00.000Z'),
          latest_printed_at: new Date('2026-06-16T00:00:00.000Z'),
          latest_print_batch_id: 'print_20260616T013000Z_batch1',
          latest_document_id: 'doc_1',
          has_file: false,
          delivered_at: null,
          alerts: ['契約書の画像/PDFが未保存です'],
        },
        {
          document_type: 'important_matters',
          label: '重要事項説明書',
          status: 'not_created',
          status_label: '未作成',
          template_name: null,
          template_version: null,
          storage_location: null,
          latest_action_at: null,
          latest_printed_at: null,
          latest_print_batch_id: null,
          latest_document_id: null,
          has_file: false,
          delivered_at: null,
          alerts: ['重要事項説明書が未作成です'],
        },
      ]),
    );
  });

  it('returns blocked print readiness when required contract print data is missing', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: new Date('1940-01-01T00:00:00.000Z'),
          phone: null,
          medical_insurance_number: null,
          care_insurance_number: null,
          residences: [],
          contacts: [],
          insurances: [],
          cases: [
            {
              id: 'case_1',
              status: 'active',
              start_date: null,
              primary_pharmacist_id: null,
            },
          ],
        }),
      },
      template: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'template_contract',
            template_type: 'contract_document',
            name: '居宅療養管理指導契約書 2026年版',
            version: 1,
            effective_from: null,
            effective_to: null,
          },
        ]),
      },
      firstVisitDocument: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    const result = await getPatientDocumentsData(
      db as unknown as Parameters<typeof getPatientDocumentsData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      },
    );

    expect(result?.print_readiness).toMatchObject({
      overall_status: 'blocked',
      missing_required_count: 4,
      warning_count: 3,
    });
    expect(result?.print_readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'primary_residence',
          completed: false,
          severity: 'required',
        }),
        expect.objectContaining({
          key: 'contact_channel',
          completed: false,
          severity: 'required',
        }),
        expect.objectContaining({
          key: 'care_insurance',
          completed: false,
          severity: 'required',
        }),
        expect.objectContaining({
          key: 'default_templates',
          completed: false,
          description: '既定テンプレート未設定: 重要事項説明書 / 個人情報同意書 / 同意書',
        }),
      ]),
    );
  });

  it('encodes patient id only in document readiness href path segments and keeps DB identity raw', async () => {
    const patientId = 'patient/1?tab=x#frag';
    const encodedPatientId = encodeURIComponent(patientId);
    const patientFindFirstMock = vi.fn().mockResolvedValue({
      id: patientId,
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      birth_date: null,
      phone: null,
      medical_insurance_number: null,
      care_insurance_number: null,
      residences: [],
      contacts: [],
      insurances: [],
      cases: [
        {
          id: 'case_1',
          status: 'active',
          start_date: null,
          primary_pharmacist_id: null,
        },
      ],
    });
    const firstVisitDocumentFindManyMock = vi.fn().mockResolvedValue([]);
    const db = buildDb({
      patient: {
        findFirst: patientFindFirstMock,
      },
      firstVisitDocument: {
        findMany: firstVisitDocumentFindManyMock,
      },
    });

    const result = await getPatientDocumentsData(
      db as unknown as Parameters<typeof getPatientDocumentsData>[0],
      {
        orgId: 'org_1',
        patientId,
        role: 'pharmacist',
        userId: 'user_1',
      },
    );

    const hrefByKey = Object.fromEntries(
      result?.print_readiness.checks.map((check) => [check.key, check.action_href]) ?? [],
    );
    expect(hrefByKey).toMatchObject({
      patient_profile: `/patients/${encodedPatientId}/edit`,
      primary_residence: `/patients/${encodedPatientId}/edit`,
      contact_channel: `/patients/${encodedPatientId}/edit`,
      care_insurance: `/patients/${encodedPatientId}#patient-profile-summary`,
      key_person: `/patients/${encodedPatientId}#patient-profile-summary`,
      service_start: `/patients/${encodedPatientId}#patient-profile-summary`,
      explainer: `/patients/${encodedPatientId}#patient-profile-summary`,
      default_templates: '/admin/document-templates',
    });
    expect(JSON.stringify(result?.print_readiness.checks)).not.toContain(`/patients/${patientId}`);
    expect(patientFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: patientId,
          org_id: 'org_1',
        }),
      }),
    );
    expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: patientId,
          case_id: { in: ['case_1'] },
        }),
      }),
    );
  });

  it('masks first-visit emergency contact channels for external viewers', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      firstVisitDocument: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'doc_1',
            case_id: 'case_1',
            document_url: null,
            delivered_at: null,
            delivered_to: null,
            created_at: new Date('2026-04-01T00:00:00.000Z'),
            updated_at: new Date('2026-04-01T00:00:00.000Z'),
            emergency_contacts: [
              {
                name: '山田 花子',
                relation: '長女',
                phone: '03-1234-5678',
                email: 'hanako@example.test',
                fax: '03-8765-4321',
                organization_name: '山田家',
                department: '家族',
                is_primary: true,
                is_emergency_contact: true,
              },
            ],
          },
        ]),
      },
    });

    const result = await getPatientDocumentsData(
      db as unknown as Parameters<typeof getPatientDocumentsData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'external_viewer',
        userId: 'user_1',
      },
    );

    expect(result?.first_visit_documents[0]?.emergency_contacts).toEqual([
      expect.objectContaining({
        name: '山田 花子',
        phone: '***-****-5678',
        email: 'h***@example.test',
        fax: '***-****-4321',
      }),
    ]);
  });
});
