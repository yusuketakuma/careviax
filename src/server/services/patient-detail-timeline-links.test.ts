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
  it('sorts mixed timeline events and preserves representative event DTO fields', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'schedule_1',
            visit_type: 'regular',
            scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
            schedule_status: 'confirmed',
            priority: 'urgent',
            pharmacist_id: 'pharmacist_1',
            confirmed_at: new Date('2026-04-03T09:00:00.000Z'),
            route_order: 2,
            created_at: new Date('2026-04-02T08:00:00.000Z'),
            updated_at: new Date('2026-04-02T09:00:00.000Z'),
            visit_record: {
              id: 'visit_record_1',
              outcome_status: 'completed',
            },
          },
        ]),
      },
      visitRecord: { findMany: vi.fn().mockResolvedValue([]) },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'audit_1',
            action: 'billing_payment_profile_updated',
            target_type: 'Patient',
            target_id: 'patient_1',
            actor_id: 'user_2',
            changes: {
              payer_name: '山田花子',
              payment_method: 'bank_transfer',
            },
            created_at: new Date('2026-04-05T11:00:00.000Z'),
          },
        ]),
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
            occurred_at: new Date('2026-04-04T10:00:00.000Z'),
          },
        ]),
      },
      patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
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

    expect(result?.timeline_events.map((item) => item.id)).toEqual([
      'operation_history:audit_1',
      'communication:communication_1',
      'visit_schedule:schedule_1',
      'care_report:report_1',
    ]);
    expect(result?.timeline_events[0]).toMatchObject({
      id: 'operation_history:audit_1',
      event_type: 'operation_history',
      category: 'billing',
      occurred_at: new Date('2026-04-05T11:00:00.000Z'),
      title: '支払設定を更新',
      summary: '支払者 山田花子 / 方法 振込',
      href: '/billing/candidates?patient_id=patient_1',
      action_label: '請求を開く',
      status: 'billing_payment_profile_updated',
      status_label: '支払設定',
      metadata: ['Patient', 'patient_1'],
    });
    expect(result?.timeline_events[2]).toMatchObject({
      id: 'visit_schedule:schedule_1',
      event_type: 'visit_schedule',
      category: 'visit',
      occurred_at: new Date('2026-04-03T09:00:00.000Z'),
      title: '訪問予定を確定',
      summary: '定期訪問 / 訪問日 2026/04/10 / 訪問記録あり',
      href: '/visits/visit_record_1',
      action_label: '訪問記録を開く',
      status: 'confirmed',
      status_label: 'confirmed',
      metadata: ['優先度 至急', 'ルート順 2'],
    });
  });

  it('encodes timeline care report hrefs while preserving raw report identities', async () => {
    const rawReportId = 'report/../x?download=1#frag';
    const rawDeliveryId = 'delivery/1?channel=fax#frag';
    const careReportFindManyMock = vi.fn().mockResolvedValue([
      {
        id: rawReportId,
        report_type: 'home_visit_report',
        status: 'draft',
        created_by: 'pharmacist_1',
        created_at: new Date('2026-04-02T10:00:00.000Z'),
        delivery_records: [
          {
            id: rawDeliveryId,
            channel: 'fax',
            recipient_name: '主治医 山田先生',
            status: 'sent',
            confirmed_at: null,
            sent_at: new Date('2026-04-03T10:00:00.000Z'),
            created_at: new Date('2026-04-03T09:00:00.000Z'),
          },
        ],
      },
    ]);
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: careReportFindManyMock,
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          delivery_records: expect.objectContaining({
            select: expect.not.objectContaining({
              recipient_name: true,
            }),
          }),
        }),
      }),
    );
    const eventsById = new Map(result?.timeline_events.map((event) => [event.id, event]));
    const encodedReportHref = `/reports/${encodeURIComponent(rawReportId)}`;
    expect(eventsById.get(`care_report:${rawReportId}`)?.href).toBe(encodedReportHref);
    expect(eventsById.get(`delivery_record:${rawDeliveryId}`)?.href).toBe(encodedReportHref);
    expect(eventsById.has(`care_report:${rawReportId}`)).toBe(true);
    expect(eventsById.has(`delivery_record:${rawDeliveryId}`)).toBe(true);
    expect(JSON.stringify(result?.timeline_events)).not.toContain(`/reports/${rawReportId}`);
    expect(JSON.stringify(result?.movement_events)).not.toContain('主治医 山田先生');
  });

  it('keeps management plan timeline events marker-only without selecting document details', async () => {
    const managementPlanFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'plan_1',
        status: 'approved',
        title: '訪問薬剤管理指導計画書 山田様',
        effective_from: new Date('2026-04-01T00:00:00.000Z'),
        next_review_date: new Date('2026-05-01T00:00:00.000Z'),
        created_by: 'user_1',
        approved_by: 'user_2',
        approved_at: new Date('2026-04-02T09:00:00.000Z'),
        reviewed_by: 'user_2',
        reviewed_at: new Date('2026-04-02T09:00:00.000Z'),
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
      managementPlan: {
        findMany: managementPlanFindManyMock,
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user_2', name: '薬剤師B' }]),
      },
    });

    const result = await getPatientTimelineData(runnerFor(db), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(managementPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          title: true,
          effective_from: true,
          next_review_date: true,
        }),
      }),
    );
    expect(result?.timeline_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'management_plan:plan_1',
          event_type: 'management_plan',
          category: 'document',
          title: '管理計画書を承認',
          summary: '管理計画書が登録または更新されました。内容は計画書で確認してください。',
          href: '/patients/patient_1/management-plan',
          action_label: '計画書を開く',
          status: 'approved',
          status_label: '承認済み',
          actor_name: null,
        }),
      ]),
    );
    const serializedMovementEvents = JSON.stringify(result?.movement_events);
    expect(serializedMovementEvents).not.toContain('訪問薬剤管理指導計画書 山田様');
    expect(serializedMovementEvents).not.toContain('2026-05-01');
  });

  it('encodes timeline visit and prescription hrefs while preserving raw identities', async () => {
    const rawScheduleWithRecordId = 'schedule/with-record?mode=x#frag';
    const rawScheduleRecordId = 'visit-record/from-schedule?mode=x#frag';
    const rawScheduleWithoutRecordId = 'schedule/no-record?mode=entry#frag';
    const rawVisitRecordId = 'visit-record/direct?mode=x#frag';
    const rawPrescriptionIntakeId = 'intake/direct?tab=x#frag';
    const rawDispenseResultId = 'dispense/1?tab=x#frag';
    const rawDispenseIntakeId = 'intake/dispense?tab=x#frag';
    const rawInquiryId = 'inquiry/1?tab=x#frag';
    const rawInquiryIntakeId = 'intake/inquiry?tab=x#frag';
    const rawInquiryWithoutIntakeId = 'inquiry/no-intake?tab=x#frag';
    const rawAuditId = 'audit/prescription?tab=x#frag';
    const rawAuditPrescriptionId = 'intake/audit?tab=x#frag';
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      visitSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawScheduleWithRecordId,
            visit_type: 'regular',
            scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
            schedule_status: 'confirmed',
            priority: null,
            pharmacist_id: 'user_1',
            confirmed_at: new Date('2026-04-09T09:00:00.000Z'),
            route_order: null,
            created_at: new Date('2026-04-08T09:00:00.000Z'),
            updated_at: null,
            visit_record: { id: rawScheduleRecordId, outcome_status: 'completed' },
          },
          {
            id: rawScheduleWithoutRecordId,
            visit_type: 'temporary',
            scheduled_date: new Date('2026-04-11T00:00:00.000Z'),
            schedule_status: 'planned',
            priority: null,
            pharmacist_id: 'user_1',
            confirmed_at: null,
            route_order: null,
            created_at: new Date('2026-04-08T10:00:00.000Z'),
            updated_at: null,
            visit_record: null,
          },
        ]),
      },
      visitRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawVisitRecordId,
            pharmacist_id: 'user_1',
            visit_date: new Date('2026-04-12T00:00:00.000Z'),
            outcome_status: 'completed',
            next_visit_suggestion_date: null,
            cancellation_reason: null,
            postpone_reason: null,
            revisit_reason: null,
            created_at: new Date('2026-04-12T09:00:00.000Z'),
          },
        ]),
      },
      prescriptionIntake: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawPrescriptionIntakeId,
            source_type: 'fax',
            prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
            prescriber_name: '山田医師',
            prescriber_institution: '山田内科',
            original_collected_by: null,
            created_at: new Date('2026-04-01T09:00:00.000Z'),
            cycle: { overall_status: 'intake_received' },
            lines: [],
          },
        ]),
      },
      dispenseResult: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawDispenseResultId,
            actual_drug_name: 'テスト薬',
            actual_quantity: 14,
            actual_unit: '錠',
            carry_type: 'carry',
            dispensed_by: 'user_1',
            dispensed_at: new Date('2026-04-02T09:00:00.000Z'),
            task: { cycle: { overall_status: 'dispensed' } },
            line: { intake: { id: rawDispenseIntakeId } },
          },
        ]),
      },
      inquiryRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawInquiryId,
            reason: '用量確認',
            inquiry_to_physician: '山田医師',
            inquiry_content: '用量を確認しました。',
            result: 'unchanged',
            proposal_origin: 'post_inquiry',
            residual_adjustment: false,
            change_detail: null,
            inquired_at: new Date('2026-04-03T09:00:00.000Z'),
            resolved_at: null,
            created_at: new Date('2026-04-03T08:00:00.000Z'),
            line: { intake: { id: rawInquiryIntakeId } },
          },
          {
            id: rawInquiryWithoutIntakeId,
            reason: '受付未連携',
            inquiry_to_physician: null,
            inquiry_content: null,
            result: null,
            proposal_origin: null,
            residual_adjustment: null,
            change_detail: null,
            inquired_at: null,
            resolved_at: null,
            created_at: new Date('2026-04-03T07:00:00.000Z'),
            line: null,
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: rawAuditId,
            action: 'prescription_original_management_updated',
            target_type: 'prescription_intake',
            target_id: rawAuditPrescriptionId,
            actor_id: 'user_1',
            changes: { storage_location: 'paper' },
            created_at: new Date('2026-04-05T11:00:00.000Z'),
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

    const eventsById = new Map(result?.timeline_events.map((event) => [event.id, event]));
    expect(eventsById.get(`visit_schedule:${rawScheduleWithRecordId}`)?.href).toBe(
      `/visits/${encodeURIComponent(rawScheduleRecordId)}`,
    );
    expect(eventsById.get(`visit_schedule:${rawScheduleWithoutRecordId}`)?.href).toBe(
      `/visits/${encodeURIComponent(rawScheduleWithoutRecordId)}/record`,
    );
    expect(eventsById.get(`visit_record:${rawVisitRecordId}`)?.href).toBe(
      `/visits/${encodeURIComponent(rawVisitRecordId)}`,
    );
    expect(eventsById.get(`prescription_intake:${rawPrescriptionIntakeId}`)?.href).toBe(
      `/prescriptions/${encodeURIComponent(rawPrescriptionIntakeId)}`,
    );
    expect(eventsById.get(`dispense_result:${rawDispenseResultId}`)?.href).toBe(
      `/prescriptions/${encodeURIComponent(rawDispenseIntakeId)}`,
    );
    expect(eventsById.get(`inquiry:${rawInquiryId}`)?.href).toBe(
      `/prescriptions/${encodeURIComponent(rawInquiryIntakeId)}`,
    );
    expect(eventsById.get(`inquiry:${rawInquiryWithoutIntakeId}`)?.href).toBe(
      '/patients/patient_1#card-prescription-section',
    );
    expect(eventsById.get(`operation_history:${rawAuditId}`)?.href).toBe(
      `/prescriptions/${encodeURIComponent(rawAuditPrescriptionId)}`,
    );
    for (const eventId of [
      `visit_schedule:${rawScheduleWithRecordId}`,
      `visit_schedule:${rawScheduleWithoutRecordId}`,
      `visit_record:${rawVisitRecordId}`,
      `prescription_intake:${rawPrescriptionIntakeId}`,
      `dispense_result:${rawDispenseResultId}`,
      `inquiry:${rawInquiryId}`,
      `inquiry:${rawInquiryWithoutIntakeId}`,
      `operation_history:${rawAuditId}`,
    ]) {
      expect(eventsById.has(eventId)).toBe(true);
    }
    const serializedEvents = JSON.stringify(result?.timeline_events);
    for (const rawVisitId of [rawScheduleRecordId, rawScheduleWithoutRecordId, rawVisitRecordId]) {
      expect(serializedEvents).not.toContain(`/visits/${rawVisitId}`);
    }
    for (const rawPrescriptionId of [
      rawPrescriptionIntakeId,
      rawDispenseIntakeId,
      rawInquiryIntakeId,
      rawAuditPrescriptionId,
    ]) {
      expect(serializedEvents).not.toContain(`/prescriptions/${rawPrescriptionId}`);
    }
    expect(serializedEvents).not.toContain('山田医師');
    expect(serializedEvents).not.toContain('山田内科');
    expect(serializedEvents).not.toContain('テスト薬');
    expect(serializedEvents).not.toContain('14錠');
    expect(serializedEvents).not.toContain('用量確認');
    expect(serializedEvents).not.toContain('用量を確認しました');
    expect(db.visitRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          cancellation_reason: true,
          postpone_reason: true,
          revisit_reason: true,
        }),
      }),
    );
    expect(db.prescriptionIntake.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          prescriber_name: true,
          prescriber_institution: true,
          original_collected_by: true,
          lines: expect.anything(),
        }),
      }),
    );
    expect(db.dispenseResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          actual_drug_name: true,
          actual_quantity: true,
          actual_unit: true,
          carry_type: true,
        }),
      }),
    );
    expect(db.inquiryRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          reason: true,
          inquiry_to_physician: true,
          inquiry_content: true,
          change_detail: true,
        }),
      }),
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment timeline report id %s', async (reportId) => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          cases: [{ id: 'case_1' }],
        }),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: reportId,
            report_type: 'home_visit_report',
            status: 'draft',
            created_by: 'pharmacist_1',
            created_at: new Date('2026-04-02T10:00:00.000Z'),
            delivery_records: [],
          },
        ]),
      },
    });

    await expect(
      getPatientTimelineData(runnerFor(db), {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      }),
    ).rejects.toThrow(RangeError);
  });

  const dotSegmentTimelineHrefCases: Array<
    [string, (dotSegment: string) => Record<string, unknown>]
  > = [
    [
      'visit schedule linked visit record',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              visit_type: 'regular',
              scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
              schedule_status: 'confirmed',
              priority: null,
              pharmacist_id: 'user_1',
              confirmed_at: new Date('2026-04-09T09:00:00.000Z'),
              route_order: null,
              created_at: new Date('2026-04-08T09:00:00.000Z'),
              updated_at: null,
              visit_record: { id: dotSegment, outcome_status: 'completed' },
            },
          ]),
        },
      }),
    ],
    [
      'visit schedule record entry',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: dotSegment,
              visit_type: 'regular',
              scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
              schedule_status: 'planned',
              priority: null,
              pharmacist_id: 'user_1',
              confirmed_at: null,
              route_order: null,
              created_at: new Date('2026-04-08T09:00:00.000Z'),
              updated_at: null,
              visit_record: null,
            },
          ]),
        },
      }),
    ],
    [
      'visit record',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        visitRecord: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: dotSegment,
              pharmacist_id: 'user_1',
              visit_date: new Date('2026-04-12T00:00:00.000Z'),
              outcome_status: 'completed',
              next_visit_suggestion_date: null,
              cancellation_reason: null,
              postpone_reason: null,
              revisit_reason: null,
              created_at: new Date('2026-04-12T09:00:00.000Z'),
            },
          ]),
        },
      }),
    ],
    [
      'prescription intake',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        prescriptionIntake: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: dotSegment,
              source_type: 'fax',
              prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
              prescriber_name: '山田医師',
              prescriber_institution: '山田内科',
              original_collected_by: null,
              created_at: new Date('2026-04-01T09:00:00.000Z'),
              cycle: { overall_status: 'intake_received' },
              lines: [],
            },
          ]),
        },
      }),
    ],
    [
      'dispense result intake',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        dispenseResult: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'dispense_1',
              actual_drug_name: 'テスト薬',
              actual_quantity: 14,
              actual_unit: '錠',
              carry_type: 'carry',
              dispensed_by: 'user_1',
              dispensed_at: new Date('2026-04-02T09:00:00.000Z'),
              task: { cycle: { overall_status: 'dispensed' } },
              line: { intake: { id: dotSegment } },
            },
          ]),
        },
      }),
    ],
    [
      'inquiry intake',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        inquiryRecord: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'inquiry_1',
              reason: '用量確認',
              inquiry_to_physician: '山田医師',
              inquiry_content: '用量を確認しました。',
              result: 'unchanged',
              proposal_origin: 'post_inquiry',
              residual_adjustment: false,
              change_detail: null,
              inquired_at: new Date('2026-04-03T09:00:00.000Z'),
              resolved_at: null,
              created_at: new Date('2026-04-03T08:00:00.000Z'),
              line: { intake: { id: dotSegment } },
            },
          ]),
        },
      }),
    ],
    [
      'prescription operation history target',
      (dotSegment) => ({
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            cases: [{ id: 'case_1' }],
          }),
        },
        auditLog: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'audit_prescription_1',
              action: 'prescription_original_management_updated',
              target_type: 'prescription_intake',
              target_id: dotSegment,
              actor_id: 'user_1',
              changes: { storage_location: 'paper' },
              created_at: new Date('2026-04-05T11:00:00.000Z'),
            },
          ]),
        },
      }),
    ],
  ];

  it.each(
    dotSegmentTimelineHrefCases.flatMap(([sourceName, buildOverrides]) =>
      ['.', '..'].map((dotSegment) => [sourceName, dotSegment, buildOverrides] as const),
    ),
  )(
    'rejects exact dot-segment timeline href id from %s: %s',
    async (_sourceName, dotSegment, buildOverrides) => {
      const db = buildDb(buildOverrides(dotSegment));

      await expect(
        getPatientTimelineData(runnerFor(db), {
          orgId: 'org_1',
          patientId: 'patient_1',
          role: 'pharmacist',
          userId: 'user_1',
        }),
      ).rejects.toThrow(RangeError);
    },
  );
});
