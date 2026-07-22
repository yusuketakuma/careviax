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

import { getPatientTimelineData } from './patient-detail';
import { buildDb, runnerFor } from './patient-detail.test-support';

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

describe('getPatientTimelineData', () => {
  it('encodes timeline patient hrefs while preserving raw patient identity queries', async () => {
    const rawPatientId = 'patient/1?tab=x#frag';
    const encodedPatientId = encodeURIComponent(rawPatientId);
    const encodedPatientQuery = `patient_id=${encodedPatientId}`;
    const patientFindFirstMock = vi.fn().mockResolvedValue({
      id: rawPatientId,
      cases: [{ id: 'case_1' }],
    });
    const externalAccessGrantFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'grant_1',
        granted_to_name: '田中ケアマネ',
        expires_at: new Date('2026-04-30T00:00:00.000Z'),
        accessed_at: null,
        created_at: new Date('2026-04-08T00:00:00.000Z'),
      },
    ]);
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_billing_1',
        action: 'billing_payment_profile_updated',
        target_type: 'Patient',
        target_id: rawPatientId,
        actor_id: 'user_1',
        changes: { payer_name: '山田花子', payment_method: 'cash' },
        created_at: new Date('2026-04-10T10:00:00.000Z'),
      },
      {
        id: 'audit_mcs_1',
        action: 'patient_mcs_profile_updated',
        target_type: 'Patient',
        target_id: rawPatientId,
        actor_id: 'user_1',
        changes: { mcs_enabled: true },
        created_at: new Date('2026-04-10T09:00:00.000Z'),
      },
      {
        id: 'audit_patient_export_1',
        action: 'export',
        target_type: 'medication_history',
        target_id: rawPatientId,
        actor_id: 'user_1',
        changes: { format: 'csv' },
        created_at: new Date('2026-04-10T08:00:00.000Z'),
      },
      {
        id: 'audit_conference_1',
        action: 'conference_note.created',
        target_type: 'conference_note',
        target_id: 'conference_1',
        actor_id: 'user_1',
        changes: { title: '退院前カンファレンス' },
        created_at: new Date('2026-04-10T07:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: patientFindFirstMock,
      },
      managementPlan: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'plan_1',
            status: 'approved',
            title: '訪問薬剤管理指導計画書',
            effective_from: new Date('2026-04-01T00:00:00.000Z'),
            next_review_date: null,
            created_by: 'user_1',
            approved_by: null,
            approved_at: null,
            reviewed_by: null,
            reviewed_at: null,
            created_at: new Date('2026-04-09T00:00:00.000Z'),
          },
        ]),
      },
      firstVisitDocument: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'doc_1',
            document_url: null,
            delivered_at: null,
            delivered_to: null,
            created_at: new Date('2026-04-08T10:00:00.000Z'),
          },
        ]),
      },
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'conference_1',
            note_type: 'discharge_conference',
            title: '退院前カンファレンス',
            conference_date: new Date('2026-04-08T09:00:00.000Z'),
            follow_up_date: null,
            follow_up_completed: false,
            generated_report_id: null,
            action_items: [],
          },
        ]),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_1',
            status: 'candidate',
            billing_month: new Date('2026-04-01T00:00:00.000Z'),
            billing_code: 'HOME_VISIT_MANAGEMENT',
            billing_name: '居宅療養管理指導',
            points: 518,
            exclusion_reason: null,
            updated_at: new Date('2026-04-08T08:00:00.000Z'),
          },
        ]),
      },
      medicationCycle: {
        findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'communication_1',
            event_type: 'family_call',
            channel: 'phone',
            direction: 'inbound',
            subject: '服薬時間を相談',
            counterpart_name: '長女',
            occurred_at: new Date('2026-04-07T10:00:00.000Z'),
          },
        ]),
      },
      patientSelfReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'self_report_1',
            subject: '夕方にふらつきあり',
            category: '副作用・体調変化',
            content: '夕方にふらつきます。',
            relation: '本人',
            status: 'submitted',
            reported_by_name: '山田花子',
            requested_callback: true,
            preferred_contact_time: '18:00以降',
            created_at: new Date('2026-04-07T09:00:00.000Z'),
          },
        ]),
      },
      externalAccessGrant: { findMany: externalAccessGrantFindManyMock },
      auditLog: { findMany: auditLogFindManyMock },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'user_1', name: '佐藤 薬剤師' }]) },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: rawPatientId,
      role: 'pharmacist',
      userId: 'user_1',
    });

    const eventsById = new Map(result?.timeline_events.map((event) => [event.id, event]));
    expect(eventsById.get('management_plan:plan_1')?.href).toBe(
      `/patients/${encodedPatientId}/management-plan`,
    );
    expect(eventsById.get('first_visit_document:doc_1')?.href).toBe(
      `/patients/${encodedPatientId}#patient-documents`,
    );
    expect(eventsById.get('operation_history:audit_mcs_1')?.href).toBe(
      `/patients/${encodedPatientId}/mcs`,
    );
    expect(eventsById.get('operation_history:audit_patient_export_1')?.href).toBe(
      `/patients/${encodedPatientId}`,
    );
    expect(eventsById.get('self_report:self_report_1')?.href).toBe(
      `/patients/${encodedPatientId}/collaboration`,
    );
    expect(eventsById.get('external_share:grant_1')?.href).toBe(
      `/patients/${encodedPatientId}/share`,
    );
    expect(eventsById.get('conference_note:conference_1')?.href).toBe(
      `/conferences?${encodedPatientQuery}`,
    );
    expect(eventsById.get('operation_history:audit_billing_1')?.href).toBe(
      `/billing/candidates?${encodedPatientQuery}`,
    );
    expect(eventsById.get('operation_history:audit_conference_1')?.href).toBe(
      `/conferences?${encodedPatientQuery}`,
    );
    expect(eventsById.get('communication:communication_1')?.href).toBe(
      `/conferences?${encodedPatientQuery}`,
    );
    expect(eventsById.get('billing_candidate:candidate_1')?.href).toBe(
      `/billing/candidates?billing_month=2026-04-01&${encodedPatientQuery}`,
    );
    expect(eventsById.get('operation_history:audit_patient_export_1')?.metadata).toEqual([]);
    expect(patientFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: rawPatientId,
          org_id: 'org_1',
        }),
      }),
    );
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: rawPatientId,
        }),
        select: expect.not.objectContaining({
          granted_to_name: true,
        }),
      }),
    );
    expect(db.conferenceNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          title: true,
          action_items: true,
        }),
      }),
    );
    expect(db.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          billing_name: true,
          points: true,
          exclusion_reason: true,
        }),
      }),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'Patient',
              target_id: rawPatientId,
            }),
            expect.objectContaining({
              target_type: {
                in: [
                  'medication_history',
                  'medication_calendar',
                  'visit_record_list',
                  'prescription_history',
                ],
              },
              target_id: rawPatientId,
            }),
          ]),
        }),
      }),
    );
    const serializedTimeline = JSON.stringify(result);
    expect(serializedTimeline).not.toContain('田中ケアマネ');
    expect(serializedTimeline).not.toContain('退院前カンファレンス');
    expect(serializedTimeline).not.toContain('居宅療養管理指導');
    expect(serializedTimeline).not.toContain('518点');
  });

  it('summarizes billing collection history with bill, payment, receipt, invoice, and unpaid evidence', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_1',
            status: 'candidate',
            billing_month: new Date('2026-06-01T00:00:00.000Z'),
            billing_code: 'HOME_VISIT_MANAGEMENT',
            billing_name: '居宅療養管理指導',
            points: 518,
            created_at: new Date('2026-06-01T00:00:00.000Z'),
            updated_at: new Date('2026-06-01T00:00:00.000Z'),
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_collection_1',
            action: 'billing_collection_updated',
            target_type: 'BillingCandidate',
            target_id: 'candidate_1',
            actor_id: 'user_2',
            changes: {
              status_before: 'candidate',
              collection: {
                status: 'partial',
                billed_amount: 3240,
                collected_amount: 2160,
                unpaid_amount: 1080,
                payment_method: 'cash',
                payer_name: '山田花子',
                collected_at: '2026-06-16T10:30:00.000Z',
                receipt_number: 'R20260616-001',
                receipt_issue_status: 'issued',
                invoice_issue_status: 'issued',
                unpaid_reason: '次回訪問時に残額集金',
              },
            },
            created_at: new Date('2026-06-16T11:00:00.000Z'),
          },
        ]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    const collectionEvent = result?.timeline_events.find(
      (item) => item.id === 'operation_history:audit_collection_1',
    );

    expect(collectionEvent).toMatchObject({
      event_type: 'operation_history',
      category: 'billing',
      title: '集金情報を更新',
      summary:
        '状態 一部入金 / 請求 3,240円 / 入金 2,160円 / 未収 1,080円 / 入金日 2026/06/16 / 入金方法 現金 / 領収証 R20260616-001 / 領収証状態 発行済み / 請求書状態 発行済み / 支払者 山田花子 / 未収理由 次回訪問時に残額集金',
      href: '/billing/candidates?patient_id=patient_1',
      action_label: '請求を開く',
      status: 'billing_collection_updated',
      status_label: '集金更新',
    });
  });

  it('adds generated billing document PDF exports to the patient operation timeline', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_billing_pdf_1',
        action: 'export',
        target_type: 'billing_invoice',
        target_id: 'candidate_1',
        actor_id: 'user_2',
        changes: {
          format: 'pdf',
          record_count: 1,
          filters: {},
          metadata: {},
        },
        created_at: new Date('2026-06-16T12:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_1',
            status: 'confirmed',
            billing_month: new Date('2026-06-01T00:00:00.000Z'),
            billing_code: 'HOME_VISIT_MANAGEMENT',
            billing_name: '居宅療養管理指導',
            points: 518,
            created_at: new Date('2026-06-01T00:00:00.000Z'),
            updated_at: new Date('2026-06-01T00:00:00.000Z'),
          },
        ]),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_2', name: '鈴木 事務' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operation_history:audit_billing_pdf_1',
          event_type: 'operation_history',
          category: 'billing',
          title: '請求書PDFを出力',
          summary: 'PDF / 1件',
          href: '/billing/candidates?patient_id=patient_1',
          action_label: '請求を開く',
          status: 'export',
          status_label: '請求書PDF',
          actor_name: '鈴木 事務',
          metadata: ['billing_invoice', 'candidate_1'],
        }),
      ]),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: { in: ['billing_receipt', 'billing_invoice'] },
              target_id: { in: ['candidate_1'] },
              action: 'export',
            }),
          ]),
        }),
      }),
    );
  });

  it('adds patient-level document exports to the patient operation timeline', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_patient_export_1',
        action: 'export',
        target_type: 'medication_calendar',
        target_id: 'patient_1',
        actor_id: 'user_2',
        changes: {
          format: 'pdf',
          record_count: 1,
          filters: {
            month: '2026-06',
          },
          metadata: {},
        },
        created_at: new Date('2026-06-16T13:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_2', name: '鈴木 事務' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operation_history:audit_patient_export_1',
          event_type: 'operation_history',
          category: 'document',
          title: '文書を出力',
          summary: '出力の操作履歴が記録されました。内容は正本画面で確認してください。',
          href: '/patients/patient_1',
          action_label: '患者詳細を開く',
          status: 'export',
          status_label: '出力',
          actor_name: null,
          metadata: [],
        }),
      ]),
    );
    const serializedTimeline = JSON.stringify(result?.timeline_events ?? []);
    expect(serializedTimeline).not.toContain('服薬カレンダー');
    expect(serializedTimeline).not.toContain('対象月');
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: {
                in: [
                  'medication_history',
                  'medication_calendar',
                  'visit_record_list',
                  'prescription_history',
                ],
              },
              target_id: 'patient_1',
              action: 'export',
            }),
          ]),
        }),
      }),
    );
  });

  it('keeps first visit document timeline events summary-only with document tab deep links', async () => {
    const firstVisitDocumentFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'doc_1',
        document_url: 'https://files.example.test/private/important-matters.pdf',
        delivered_at: null,
        delivered_to: '山田花子',
        created_at: new Date('2026-04-01T09:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      firstVisitDocument: {
        findMany: firstVisitDocumentFindManyMock,
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_doc_1',
            action: 'first_visit_document.generated',
            target_type: 'first_visit_document',
            target_id: 'doc_1',
            actor_id: 'user_1',
            changes: {
              document_action: {
                action: 'generated',
                document_type: 'important_matters',
                template_name: '重要事項説明書 2026年版',
                template_version: 'v2',
                storage_location: 'store',
                reason: '署名者を長女へ訂正',
                note: '患者詳細から作成',
              },
            },
            created_at: new Date('2026-04-02T10:00:00.000Z'),
          },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_1', name: '佐藤 薬剤師' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'first_visit_document:doc_1',
          event_type: 'first_visit_document',
          category: 'document',
          occurred_at: new Date('2026-04-02T10:00:00.000Z'),
          title: '初回訪問文書を作成',
          summary: '初回訪問文書が登録されました。内容は共有・文書で確認してください。',
          href: '/patients/patient_1#patient-documents',
          action_label: '文書状態を開く',
          status: 'generated',
          status_label: '作成',
          actor_name: null,
          metadata: [],
        }),
      ]),
    );
    expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          document_url: true,
          delivered_to: true,
        }),
      }),
    );
    const serializedTimeline = JSON.stringify(result?.timeline_events ?? []);
    expect(serializedTimeline).not.toContain('files.example.test');
    expect(serializedTimeline).not.toContain('山田花子');
    expect(serializedTimeline).not.toContain('important_matters');
    expect(serializedTimeline).not.toContain('重要事項説明書');
    expect(serializedTimeline).not.toContain('重要事項説明書 2026年版');
    expect(serializedTimeline).not.toContain('署名者を長女へ訂正');
    expect(serializedTimeline).not.toContain('患者詳細から作成');
    expect(db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'first_visit_document',
              target_id: { in: ['doc_1'] },
              action: { startsWith: 'first_visit_document.' },
            }),
          ]),
        }),
      }),
    );
  });

  it('normalizes unknown first visit document audit labels before projecting movement markers', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      firstVisitDocument: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'doc_unsafe',
            delivered_at: null,
            created_at: new Date('2026-04-01T09:00:00.000Z'),
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_doc_unsafe',
            action: 'first_visit_document.generated',
            target_type: 'first_visit_document',
            target_id: 'doc_unsafe',
            actor_id: 'user_1',
            changes: {
              document_action: {
                action: 'patient_named_custom_action',
                document_type: 'patient_named_custom_document',
                template_name: '患者名入りテンプレート',
                template_version: 'patient-v1',
                storage_location: 'patient_home_private_box',
                reason: '患者名入り理由',
                note: '患者名入りメモ',
              },
            },
            created_at: new Date('2026-04-02T10:00:00.000Z'),
          },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_1', name: '佐藤 薬剤師' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'first_visit_document:doc_unsafe',
          event_type: 'first_visit_document',
          category: 'document',
          title: '初回訪問文書を更新',
          status: 'updated',
          status_label: '更新',
          href: '/patients/patient_1#patient-documents',
        }),
      ]),
    );
    const serialized = JSON.stringify(result?.movement_events ?? []);
    for (const forbidden of [
      'patient_named_custom_action',
      'patient_named_custom_document',
      '患者名入りテンプレート',
      'patient-v1',
      'patient_home_private_box',
      '患者名入り理由',
      '患者名入りメモ',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
