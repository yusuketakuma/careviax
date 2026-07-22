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
  it('renders operation history summaries with pharmacy workflow labels', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      prescriptionIntake: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'intake_1',
            source_type: 'fax',
            prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
            prescriber_name: '山田医師',
            prescriber_institution: '山田内科',
            original_collected_by: null,
            created_at: new Date('2026-04-01T09:00:00.000Z'),
            cycle: { overall_status: 'intake_received' },
            lines: [{ id: 'line_1' }],
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_prescription_1',
            action: 'prescription_original_management_updated',
            target_type: 'prescription_intake',
            target_id: 'intake_1',
            actor_id: 'user_1',
            changes: {
              reconciliation_result: 'discrepancy',
              storage_location: 'electronic',
              e_prescription_acquired_status: 'acquired',
              e_prescription_exchange_number: 'EP-12345',
              dispensing_result_registration: 'registered',
            },
            created_at: new Date('2026-04-05T11:00:00.000Z'),
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
          id: 'operation_history:audit_prescription_1',
          event_type: 'operation_history',
          category: 'prescription',
          title: '処方せん原本管理を更新',
          summary:
            '処方せん原本または処方関連文書の操作履歴が記録されました。内容は処方詳細で確認してください。',
          href: '/prescriptions/intake_1',
          action_label: '処方受付を開く',
          status_label: '原本管理',
          actor_name: null,
          metadata: [],
        }),
      ]),
    );
    expect(JSON.stringify(result?.timeline_events ?? [])).not.toContain('EP-12345');
  });

  it('adds prescription original document retention audits to the patient operation timeline', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_rx_doc_1',
        action: 'prescription_original_document_saved',
        target_type: 'prescription_intake',
        target_id: 'intake_1',
        actor_id: 'user_1',
        changes: {
          patient_id: 'patient_1',
          case_id: 'case_1',
          document_url_type: 'internal_file',
          file_id: '11111111-1111-4111-8111-111111111111',
          saved_at: '2026-04-05T11:00:00.000Z',
          updated_by: 'user_1',
        },
        created_at: new Date('2026-04-05T11:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      prescriptionIntake: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'intake_1',
            source_type: 'fax',
            prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
            prescriber_name: '山田医師',
            prescriber_institution: '山田内科',
            original_collected_by: null,
            created_at: new Date('2026-04-01T09:00:00.000Z'),
            cycle: { overall_status: 'intake_received' },
            lines: [{ id: 'line_1' }],
          },
        ]),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
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
          id: 'operation_history:audit_rx_doc_1',
          event_type: 'operation_history',
          category: 'prescription',
          title: '処方せん画像/PDFを保存',
          summary:
            '処方せん原本または処方関連文書の操作履歴が記録されました。内容は処方詳細で確認してください。',
          href: '/prescriptions/intake_1',
          action_label: '処方受付を開く',
          status: 'prescription_original_document_saved',
          status_label: '画像保存',
          actor_name: null,
          metadata: [],
        }),
      ]),
    );
    expect(JSON.stringify(result?.timeline_events ?? [])).not.toContain(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'prescription_intake',
              target_id: { in: ['intake_1'] },
              action: expect.objectContaining({
                in: expect.arrayContaining(['prescription_original_document_saved']),
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it('adds MCS check logs to the patient operation timeline', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_mcs_1',
        action: 'patient_mcs_check_log_created',
        target_type: 'Patient',
        target_id: 'patient_1',
        actor_id: 'user_1',
        changes: {
          content_type: 'instruction_check',
          summary: '訪看から食欲低下の共有を確認',
          next_action: '医師へ服薬状況を確認',
          occurred_at: '2026-06-16T00:00:00.000Z',
          communication_event_id: 'event_1',
        },
        created_at: new Date('2026-06-16T00:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
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
          id: 'operation_history:audit_mcs_1',
          event_type: 'operation_history',
          category: 'communication',
          title: 'MCS確認ログを登録',
          summary: '指示確認 / 訪看から食欲低下の共有を確認 / 次 医師へ服薬状況を確認',
          href: '/patients/patient_1/mcs',
          action_label: 'MCS連携を開く',
          status: 'patient_mcs_check_log_created',
          status_label: 'MCS確認',
          actor_name: '佐藤 薬剤師',
        }),
      ]),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'Patient',
              target_id: 'patient_1',
              action: {
                in: expect.arrayContaining(['patient_mcs_check_log_created']),
              },
            }),
          ]),
        }),
      }),
    );
  });

  it('adds patient contact updates to the operation timeline without contact PHI exposure', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_contacts_1',
        action: 'patient_contacts_updated',
        target_type: 'Patient',
        target_id: 'patient_1',
        actor_id: 'user_1',
        changes: {
          contact_count: 2,
          contact_name: '長男',
          phone: '090-1111-1111',
          email: 'family@example.com',
          address: '東京都千代田区1-2-3',
        },
        created_at: new Date('2026-06-17T00:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
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
          id: 'operation_history:audit_contacts_1',
          event_type: 'operation_history',
          category: 'communication',
          title: '連絡先を更新',
          summary: '連絡先 2件',
          href: '/patients/patient_1',
          action_label: '患者詳細を開く',
          status: 'patient_contacts_updated',
          status_label: '連絡先更新',
          actor_name: '佐藤 薬剤師',
        }),
      ]),
    );
    const timelineJson = JSON.stringify(result?.timeline_events);
    expect(timelineJson).not.toMatch(/長男|090-1111-1111|family@example.com|東京都千代田区/);
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'Patient',
              target_id: 'patient_1',
              action: {
                in: expect.arrayContaining(['patient_contacts_updated']),
              },
            }),
          ]),
        }),
      }),
    );
  });

  it('adds conference operation audits to the patient timeline without note body exposure', async () => {
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_conference_1',
        action: 'conference_note.created',
        target_type: 'conference_note',
        target_id: 'conference_1',
        actor_id: 'user_1',
        changes: {
          conference_note: {
            note_type: 'service_manager',
            report_type: 'care_manager_report',
            follow_up_date: '2026-04-06T00:00:00.000Z',
            follow_up_completed: false,
            action_item_count: 2,
            billing_code: 'MED_INFO_PROVISION_2_HA',
          },
        },
        created_at: new Date('2026-04-05T11:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'conference_1',
            note_type: 'service_manager',
            title: '山田 太郎様 サービス担当者会議',
            conference_date: new Date('2026-04-05T10:00:00.000Z'),
            follow_up_date: new Date('2026-04-06T00:00:00.000Z'),
            follow_up_completed: false,
            generated_report_id: null,
            action_items: [{ title: '報告書作成' }, { title: '次回訪問調整' }],
          },
        ]),
      },
      auditLog: {
        findMany: auditLogFindManyMock,
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
          id: 'operation_history:audit_conference_1',
          event_type: 'operation_history',
          category: 'communication',
          title: 'カンファレンス記録を登録',
          summary:
            '担当者会議 / 報告用途 ケアマネ向け / フォロー期限 2026/04/06 / フォロー 未完了 / 薬局タスク 2件 / 算定 MED_INFO_PROVISION_2_HA',
          href: '/conferences?patient_id=patient_1',
          action_label: '会議を開く',
          status: 'conference_note.created',
          status_label: '会議登録',
          actor_name: '佐藤 薬剤師',
        }),
      ]),
    );
    expect(db.conferenceNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          title: true,
          action_items: true,
        }),
      }),
    );
    expect(JSON.stringify(result?.timeline_events)).not.toContain('退院後の服薬支援本文');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('山田 太郎様 サービス担当者会議');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('報告書作成');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('次回訪問調整');
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'conference_note',
              target_id: { in: ['conference_1'] },
              action: { startsWith: 'conference_note.' },
            }),
          ]),
        }),
      }),
    );
  });

  it('scopes conference notes to patient-level notes or assigned cases', async () => {
    const conferenceNoteFindManyMock = vi.fn().mockResolvedValue([]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      visitRecord: { findMany: vi.fn().mockResolvedValue([]) },
      careReport: { findMany: vi.fn().mockResolvedValue([]) },
      communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
      patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
      externalAccessGrant: { findMany: vi.fn().mockResolvedValue([]) },
      inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
      prescriptionIntake: { findMany: vi.fn().mockResolvedValue([]) },
      dispenseResult: { findMany: vi.fn().mockResolvedValue([]) },
      managementPlan: { findMany: vi.fn().mockResolvedValue([]) },
      firstVisitDocument: { findMany: vi.fn().mockResolvedValue([]) },
      conferenceNote: { findMany: conferenceNoteFindManyMock },
      billingCandidate: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
    });

    await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(conferenceNoteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ patient_id: 'patient_1', case_id: null }, { case_id: { in: ['case_1'] } }],
        }),
      }),
    );
  });

  it('keeps patient-level conference notes in the timeline when the patient has no cases', async () => {
    const conferenceNoteFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'conference_patient_level',
        note_type: 'service_manager',
        title: 'ケース作成前の担当者会議',
        conference_date: new Date('2026-04-08T10:00:00.000Z'),
        follow_up_date: null,
        follow_up_completed: true,
        generated_report_id: null,
        action_items: [],
      },
    ]);
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_conference_patient_level',
        action: 'conference_note.created',
        target_type: 'conference_note',
        target_id: 'conference_patient_level',
        actor_id: 'user_2',
        changes: { conference_note: { note_type: 'service_manager' } },
        created_at: new Date('2026-04-08T11:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [],
        }),
      },
      conferenceNote: { findMany: conferenceNoteFindManyMock },
      auditLog: { findMany: auditLogFindManyMock },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_2', name: '佐藤 薬剤師' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(conferenceNoteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          OR: [{ patient_id: 'patient_1', case_id: null }],
        },
      }),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              target_type: 'conference_note',
              target_id: { in: ['conference_patient_level'] },
            }),
          ]),
        }),
      }),
    );
    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'conference_note:conference_patient_level',
          event_type: 'conference_note',
        }),
        expect.objectContaining({
          id: 'operation_history:audit_conference_patient_level',
          title: 'カンファレンス記録を登録',
          actor_name: '佐藤 薬剤師',
        }),
      ]),
    );
  });

  it('omits billing candidates and billing operation history for non-billing roles', async () => {
    const billingCandidateFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'candidate_1',
        status: 'candidate',
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        billing_code: 'HOME_VISIT_MANAGEMENT',
        billing_name: '居宅療養管理指導',
        points: 518,
        exclusion_reason: null,
        updated_at: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
    const medicationCycleFindManyMock = vi.fn().mockResolvedValue([{ id: 'cycle_1' }]);
    const auditLogFindManyMock = vi.fn().mockImplementation((args) =>
      JSON.stringify(args).includes('billing_payment_profile_updated')
        ? Promise.resolve([
            {
              id: 'audit_billing_profile',
              action: 'billing_payment_profile_updated',
              target_type: 'Patient',
              target_id: 'patient_1',
              actor_id: 'billing_user',
              changes: {
                payer_name: '山田花子',
                payment_method: 'bank_transfer',
                collection: { receipt_number: 'R-001', unpaid_reason: '次回訪問時に集金' },
              },
              created_at: new Date('2026-06-01T01:00:00.000Z'),
            },
          ])
        : Promise.resolve([]),
    );
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      billingCandidate: { findMany: billingCandidateFindManyMock },
      medicationCycle: {
        findMany: medicationCycleFindManyMock,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      auditLog: { findMany: auditLogFindManyMock },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist_trainee',
      userId: 'user_1',
    });

    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(JSON.stringify(auditLogFindManyMock.mock.calls[0]?.[0])).not.toContain(
      'billing_payment_profile_updated',
    );
    expect(JSON.stringify(result?.timeline_events)).not.toContain('居宅療養管理指導');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('/billing/candidates');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('山田花子');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('R-001');
  });

  it('filters timeline external shares by assigned case boundary', async () => {
    const externalAccessGrantFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'grant_visible',
        granted_to_name: '田中ケアマネ',
        expires_at: new Date('2026-04-03T00:00:00.000Z'),
        accessed_at: null,
        created_at: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      visitRecord: { findMany: vi.fn().mockResolvedValue([]) },
      careReport: { findMany: vi.fn().mockResolvedValue([]) },
      communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
      patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
      externalAccessGrant: { findMany: externalAccessGrantFindManyMock },
      inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
      prescriptionIntake: { findMany: vi.fn().mockResolvedValue([]) },
      dispenseResult: { findMany: vi.fn().mockResolvedValue([]) },
      managementPlan: { findMany: vi.fn().mockResolvedValue([]) },
      firstVisitDocument: { findMany: vi.fn().mockResolvedValue([]) },
      conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
      billingCandidate: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.timeline_events).toEqual([
      expect.objectContaining({
        id: 'external_share:grant_visible',
      }),
    ]);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledTimes(1);
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'patient_1',
          revoked_at: null,
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                { scope: { path: ['allowed_case_ids'], array_contains: ['case_1'] } },
              ]),
            }),
          ]),
        }),
        take: 8,
        select: expect.not.objectContaining({
          granted_to_name: true,
        }),
      }),
    );
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).not.toHaveProperty('skip');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('grant_hidden');
    expect(JSON.stringify(result?.timeline_events)).not.toContain('田中ケアマネ');
  });
});
