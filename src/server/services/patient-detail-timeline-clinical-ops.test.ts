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
  it('adds self reports to timeline and avoids duplicate self-report communication events', async () => {
    const communicationEventFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'comm_self_report',
        event_type: 'patient_self_report',
        channel: 'phone',
        direction: 'inbound',
        occurred_at: new Date('2026-04-03T09:01:00.000Z'),
      },
      {
        id: 'comm_family_call',
        event_type: 'family_call',
        channel: 'phone',
        direction: 'inbound',
        occurred_at: new Date('2026-04-03T10:00:00.000Z'),
      },
      {
        id: 'comm_care_manager_fax',
        event_type: 'care_update',
        channel: 'fax',
        direction: 'inbound',
        occurred_at: new Date('2026-04-03T11:00:00.000Z'),
      },
      {
        id: 'comm_facility_email',
        event_type: 'care_update',
        channel: 'email',
        direction: 'inbound',
        occurred_at: new Date('2026-04-03T12:00:00.000Z'),
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
      communicationEvent: {
        findMany: communicationEventFindManyMock,
      },
      patientSelfReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'self_report_1',
            subject: '夕方にふらつきあり',
            category: '副作用・体調変化',
            content: '夕方になると立ち上がり時にふらつきます。折り返し連絡を希望します。',
            relation: '本人',
            status: 'submitted',
            reported_by_name: '山田花子',
            requested_callback: true,
            preferred_contact_time: '18:00以降',
            created_at: new Date('2026-04-03T09:00:00.000Z'),
          },
        ]),
      },
      externalAccessGrant: { findMany: vi.fn().mockResolvedValue([]) },
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

    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'self_report:self_report_1',
          event_type: 'self_report',
          title: '患者から自己申告を受信',
          summary: '副作用・体調変化 / 折返し希望',
          status_label: '未対応',
          actor_name: null,
          metadata: expect.arrayContaining(['関係 本人', '折返し希望', '希望時間 18:00以降']),
        }),
        expect.objectContaining({
          id: 'communication:comm_family_call',
          event_type: 'inbound_phone',
          category: 'interprofessional',
          title: '電話連絡を受信',
          summary: '他職種からの受信情報がありました。内容は連絡履歴で確認してください。',
          status_label: '受信',
          metadata: ['電話'],
        }),
        expect.objectContaining({
          id: 'communication:comm_care_manager_fax',
          event_type: 'inbound_fax',
          category: 'interprofessional',
          title: 'FAX連絡を受信',
          summary: '他職種からの受信情報がありました。内容は連絡履歴で確認してください。',
          metadata: ['FAX'],
        }),
        expect.objectContaining({
          id: 'communication:comm_facility_email',
          event_type: 'inbound_email',
          category: 'interprofessional',
          title: 'メール連絡を受信',
          summary: '他職種からの受信情報がありました。内容は連絡履歴で確認してください。',
          metadata: ['メール'],
        }),
      ]),
    );
    expect(communicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          event_type: { not: 'patient_self_report' },
        }),
        select: expect.not.objectContaining({
          subject: true,
          counterpart_name: true,
          counterpart_contact: true,
          content: true,
          attachments: true,
        }),
        take: 8,
      }),
    );
    expect(db.patientSelfReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          subject: true,
          content: true,
          reported_by_name: true,
        }),
      }),
    );
    expect(result?.timeline_events.map((item) => item.id)).not.toContain(
      'communication:comm_self_report',
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('服薬時間を相談');
    expect(serialized).not.toContain('長女');
    expect(serialized).not.toContain('夕方にふらつきあり');
    expect(serialized).not.toContain('夕方になると立ち上がり時にふらつきます');
    expect(serialized).not.toContain('山田花子');
  });

  it('adds MCS and partner visit records to movement timeline without selecting raw message bodies', async () => {
    const patientMcsMessageFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'mcs_message_1',
        author_name: '訪問看護師A',
        author_role: '訪問看護師',
        author_organization: '訪問看護ステーション',
        posted_at: new Date('2026-04-04T09:00:00.000Z'),
        posted_at_label: '2026/04/04 18:00',
        reaction_count: 1,
        reply_count: 2,
        created_at: new Date('2026-04-04T09:01:00.000Z'),
      },
    ]);
    const partnerVisitRecordFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'partner_visit_record_1',
        status: 'confirmed',
        pharmacist_name: '協力薬局 薬剤師',
        visit_at: new Date('2026-04-03T01:00:00.000Z'),
        submitted_at: new Date('2026-04-03T03:00:00.000Z'),
        confirmed_at: new Date('2026-04-03T04:00:00.000Z'),
        updated_at: new Date('2026-04-03T04:00:00.000Z'),
        owner_partner_pharmacy: { name: '協力薬局' },
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      patientMcsMessage: {
        findMany: patientMcsMessageFindManyMock,
      },
      partnerVisitRecord: {
        findMany: partnerVisitRecordFindManyMock,
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(patientMcsMessageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', patient_id: 'patient_1' },
        select: expect.not.objectContaining({
          author_name: true,
          author_role: true,
          author_organization: true,
          posted_at_label: true,
          body: true,
          raw_payload: true,
          source_url: true,
        }),
      }),
    );
    expect(partnerVisitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          share_case: { base_patient_id: 'patient_1' },
          status: { in: ['submitted', 'confirmed'] },
        }),
        select: expect.not.objectContaining({
          pharmacist_name: true,
          owner_partner_pharmacy: true,
          record_content: true,
          attachments: true,
        }),
      }),
    );

    expect(result?.movement_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'patient_mcs_message:mcs_message_1',
          event_type: 'inbound_mcs',
          category: 'interprofessional',
          title: 'MCS投稿を受信',
          href: '/patients/patient_1/mcs',
          action_label: 'MCS連携を開く',
          actor_name: null,
          privacy_level: 'summary',
        }),
        expect.objectContaining({
          id: 'partner_visit_record:partner_visit_record_1',
          event_type: 'interprofessional_note',
          category: 'interprofessional',
          title: '協力薬局の訪問記録を確認',
          href: '/patients/patient_1/collaboration',
          action_label: '連携記録を開く',
          actor_name: null,
          privacy_level: 'summary',
        }),
      ]),
    );

    const serialized = JSON.stringify(result?.movement_events);
    expect(serialized).not.toContain('raw_payload');
    expect(serialized).not.toContain('source_url');
    expect(serialized).not.toContain('record_content');
    expect(serialized).not.toContain('SOAP');
    expect(serialized).not.toContain('訪問看護師A');
    expect(serialized).not.toContain('訪問看護ステーション');
    expect(serialized).not.toContain('協力薬局 薬剤師');
  });

  it('adds patient and case operational tasks to movement timeline without selecting task free text', async () => {
    const taskFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'task_patient_1',
        task_type: 'patient_self_report_followup',
        status: 'pending',
        priority: 'high',
        due_date: new Date('2026-04-07T09:00:00.000Z'),
        sla_due_at: null,
        completed_at: null,
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        created_at: new Date('2026-04-04T10:00:00.000Z'),
        updated_at: new Date('2026-04-04T10:00:00.000Z'),
      },
      {
        id: 'task_case_1',
        task_type: 'risk_medication',
        status: 'completed',
        priority: 'urgent',
        due_date: null,
        sla_due_at: new Date('2026-04-05T09:00:00.000Z'),
        completed_at: new Date('2026-04-04T11:00:00.000Z'),
        related_entity_type: 'case',
        related_entity_id: 'case_1',
        created_at: new Date('2026-04-04T08:00:00.000Z'),
        updated_at: new Date('2026-04-04T11:00:00.000Z'),
      },
      {
        id: 'task_inbound_safety_1',
        task_type: 'pharmacy.inbound_medication_safety_review_required',
        status: 'pending',
        priority: 'urgent',
        due_date: null,
        sla_due_at: new Date('2026-04-04T12:00:00.000Z'),
        completed_at: null,
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        created_at: new Date('2026-04-04T11:30:00.000Z'),
        updated_at: new Date('2026-04-04T11:30:00.000Z'),
      },
      {
        id: 'task_inbound_communication_1',
        task_type: 'core.inbound_communication_review_required',
        status: 'pending',
        priority: 'high',
        due_date: null,
        sla_due_at: new Date('2026-04-04T12:15:00.000Z'),
        completed_at: null,
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        created_at: new Date('2026-04-04T12:00:00.000Z'),
        updated_at: new Date('2026-04-04T12:00:00.000Z'),
      },
      {
        id: 'task_stock_signal_1',
        task_type: 'pharmacy.medication_stock_external_observation_review_required',
        status: 'pending',
        priority: 'high',
        due_date: null,
        sla_due_at: new Date('2026-04-04T13:00:00.000Z'),
        completed_at: null,
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        created_at: new Date('2026-04-04T12:30:00.000Z'),
        updated_at: new Date('2026-04-04T12:30:00.000Z'),
      },
      {
        id: 'task_inbound_schedule_1',
        task_type: 'pharmacy.inbound_schedule_request_review_required',
        status: 'pending',
        priority: 'high',
        due_date: null,
        sla_due_at: new Date('2026-04-04T14:00:00.000Z'),
        completed_at: null,
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        created_at: new Date('2026-04-04T13:30:00.000Z'),
        updated_at: new Date('2026-04-04T13:30:00.000Z'),
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      task: {
        count: vi.fn().mockResolvedValue(5),
        findMany: taskFindManyMock,
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: expect.arrayContaining([
            {
              related_entity_type: 'patient',
              related_entity_id: 'patient_1',
            },
            {
              related_entity_type: 'case',
              related_entity_id: { in: ['case_1'] },
            },
          ]),
        }),
        select: expect.not.objectContaining({
          title: true,
          description: true,
          metadata: true,
        }),
      }),
    );

    expect(result?.movement_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task:task_patient_1',
          event_type: 'task_created',
          category: 'task',
          title: '運用タスクを作成',
          href: '/tasks?status=&task_type=patient_self_report_followup&related_entity_type=patient&related_entity_id=patient_1',
          action_label: 'タスクを開く',
          status: 'pending',
          status_label: '未着手',
          privacy_level: 'summary',
        }),
        expect.objectContaining({
          id: 'task:task_case_1',
          event_type: 'safety_signal',
          category: 'safety',
          title: '安全確認タスクを完了',
          href: '/tasks?status=&task_type=risk_medication&related_entity_type=case&related_entity_id=case_1',
          status: 'completed',
          status_label: '完了',
          privacy_level: 'summary',
        }),
        expect.objectContaining({
          id: 'task:task_inbound_safety_1',
          event_type: 'safety_signal',
          category: 'safety',
          title: '安全確認タスクを作成',
          href: '/tasks?status=&task_type=pharmacy.inbound_medication_safety_review_required&related_entity_type=patient&related_entity_id=patient_1',
          status: 'pending',
          status_label: '未着手',
          privacy_level: 'summary',
        }),
        expect.objectContaining({
          id: 'task:task_inbound_communication_1',
          event_type: 'inbound_communication',
          category: 'interprofessional',
          title: '他職種受信確認タスクを作成',
          href: '/tasks?status=&task_type=core.inbound_communication_review_required&related_entity_type=patient&related_entity_id=patient_1',
          status: 'pending',
          status_label: '未着手',
          privacy_level: 'summary',
        }),
        expect.objectContaining({
          id: 'task:task_stock_signal_1',
          event_type: 'inbound_medication_stock_signal',
          category: 'medication_stock',
          title: '残数確認タスクを作成',
          href: '/tasks?status=&task_type=pharmacy.medication_stock_external_observation_review_required&related_entity_type=patient&related_entity_id=patient_1',
          status: 'pending',
          status_label: '未着手',
          privacy_level: 'summary',
        }),
        expect.objectContaining({
          id: 'task:task_inbound_schedule_1',
          event_type: 'task_created',
          category: 'task',
          title: '運用タスクを作成',
          href: '/tasks?status=&task_type=pharmacy.inbound_schedule_request_review_required&related_entity_type=patient&related_entity_id=patient_1',
          status: 'pending',
          status_label: '未着手',
          privacy_level: 'summary',
        }),
      ]),
    );

    const serialized = JSON.stringify(result?.movement_events);
    expect(serialized).not.toContain('患者名入りタスク本文');
    expect(serialized).not.toContain('description');
  });

  it('adds visit-derived residual medication events without selecting drug details or quantities', async () => {
    const visitRecordFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'visit_record_1',
        pharmacist_id: 'pharmacist_1',
        visit_date: new Date('2026-04-05T01:00:00.000Z'),
        outcome_status: 'completed',
        next_visit_suggestion_date: null,
        cancellation_reason: null,
        postpone_reason: null,
        revisit_reason: null,
        created_at: new Date('2026-04-05T01:30:00.000Z'),
      },
      {
        id: 'visit_record_2',
        pharmacist_id: 'pharmacist_1',
        visit_date: new Date('2026-04-01T01:00:00.000Z'),
        outcome_status: 'completed',
        next_visit_suggestion_date: null,
        cancellation_reason: null,
        postpone_reason: null,
        revisit_reason: null,
        created_at: new Date('2026-04-01T01:30:00.000Z'),
      },
    ]);
    const residualMedicationFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'residual_1',
        visit_record_id: 'visit_record_1',
        is_reduction_target: true,
        is_prohibited_reduction: false,
        created_at: new Date('2026-04-05T01:35:00.000Z'),
        drug_name: '患者に見せるべきではない薬剤名',
        remaining_quantity: 12,
      },
      {
        id: 'residual_2',
        visit_record_id: 'visit_record_1',
        is_reduction_target: false,
        is_prohibited_reduction: false,
        created_at: new Date('2026-04-05T01:34:00.000Z'),
        drug_name: '別の薬剤名',
        remaining_quantity: 6,
      },
      {
        id: 'residual_3',
        visit_record_id: 'visit_record_2',
        is_reduction_target: false,
        is_prohibited_reduction: true,
        created_at: new Date('2026-04-01T01:35:00.000Z'),
        drug_name: '麻薬名',
        remaining_quantity: 1,
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitRecord: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: visitRecordFindManyMock,
      },
      residualMedication: {
        findMany: residualMedicationFindManyMock,
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(residualMedicationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          visit_record_id: { in: ['visit_record_1', 'visit_record_2'] },
        },
        select: expect.not.objectContaining({
          drug_name: true,
          remaining_quantity: true,
          prescribed_quantity: true,
          remaining_days: true,
          excess_days: true,
        }),
      }),
    );

    expect(result?.movement_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'residual_medication:visit_record_1',
          event_type: 'medication_stock_event',
          category: 'medication_stock',
          title: '残薬確認を記録',
          summary: '訪問記録に残薬確認が記録されました。内容は訪問記録で確認してください。',
          href: '/visits/visit_record_1',
          action_label: '訪問記録を開く',
          status: 'reduction_target',
          status_label: '減数検討',
          privacy_level: 'summary',
          metadata: ['残薬記録 2件', '完了'],
        }),
        expect.objectContaining({
          id: 'residual_medication:visit_record_2',
          event_type: 'medication_stock_event',
          status: 'prohibited_reduction',
          status_label: '減数不可',
          href: '/visits/visit_record_2',
          metadata: ['残薬記録 1件', '完了'],
        }),
      ]),
    );

    const serialized = JSON.stringify(result?.movement_events);
    expect(serialized).not.toContain('患者に見せるべきではない薬剤名');
    expect(serialized).not.toContain('別の薬剤名');
    expect(serialized).not.toContain('麻薬名');
    expect(serialized).not.toContain('remaining_quantity');
  });

  it('bounds first-visit document timeline reads and keeps legacy audit filters visible', async () => {
    const firstVisitDocumentFindManyMock = vi.fn().mockResolvedValue([]);
    const auditLogFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'audit_legacy_export',
        action: 'export',
        target_type: 'medication_history',
        target_id: 'patient_1',
        actor_id: 'user_1',
        changes: {
          export: { target_type: 'medication_history' },
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
      firstVisitDocument: { findMany: firstVisitDocumentFindManyMock },
      auditLog: { findMany: auditLogFindManyMock },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          case_id: { in: ['case_1'] },
        }),
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: 8,
      }),
    );
    expect(auditLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
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
            },
          ]),
        }),
      }),
    );
    expect(JSON.stringify(auditLogFindManyMock.mock.calls[0]?.[0])).not.toContain('patient_id');
    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operation_history:audit_legacy_export',
          title: '文書を出力',
          summary: '出力の操作履歴が記録されました。内容は正本画面で確認してください。',
          status_label: '出力',
          metadata: [],
        }),
      ]),
    );
  });
});
