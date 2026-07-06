import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCaseRiskCockpit, type CaseRiskCockpitDb } from './case-risk-cockpit';

function buildDb() {
  return {
    careCase: { findFirst: vi.fn() },
    consentRecord: { findFirst: vi.fn() },
    firstVisitDocument: { findFirst: vi.fn() },
    managementPlan: { findFirst: vi.fn() },
    visitSchedule: { findMany: vi.fn() },
    careReport: { findMany: vi.fn() },
    dispenseTask: { findMany: vi.fn() },
    prescriptionLine: { findMany: vi.fn() },
    notification: { findMany: vi.fn() },
    residence: { findMany: vi.fn() },
    patientMcsLink: { findMany: vi.fn() },
    communicationEvent: { findMany: vi.fn() },
    patientShareCase: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    billingEvidence: { findMany: vi.fn() },
  };
}

function asDb(db: ReturnType<typeof buildDb>) {
  return db as unknown as CaseRiskCockpitDb;
}

function baseCase(patientId = 'patient_1') {
  return {
    id: 'case_1',
    display_id: 'CASE-001',
    status: 'active',
    patient_id: patientId,
    primary_pharmacist_id: 'user_1',
    primary_staff_id: null,
    patient: {
      id: patientId,
      display_id: 'PAT-001',
      name: '患者 太郎',
    },
  };
}

describe('getCaseRiskCockpit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null without fetching downstream risk data when scoped case is unavailable', async () => {
    const db = buildDb();
    db.careCase.findFirst.mockResolvedValue(null);

    const result = await getCaseRiskCockpit(asDb(db), {
      orgId: 'org_1',
      caseId: 'case_1',
      userId: 'user_1',
      role: 'pharmacist',
      now: new Date('2026-07-06T00:00:00.000Z'),
    });

    expect(result).toBeNull();
    expect(db.careCase.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'case_1',
          org_id: 'org_1',
        }),
      }),
    );
    expect(db.consentRecord.findFirst).not.toHaveBeenCalled();
    expect(db.managementPlan.findFirst).not.toHaveBeenCalled();
    expect(db.firstVisitDocument.findFirst).not.toHaveBeenCalled();
    expect(db.visitSchedule.findMany).not.toHaveBeenCalled();
    expect(db.careReport.findMany).not.toHaveBeenCalled();
    expect(db.dispenseTask.findMany).not.toHaveBeenCalled();
    expect(db.prescriptionLine.findMany).not.toHaveBeenCalled();
    expect(db.notification.findMany).not.toHaveBeenCalled();
    expect(db.residence.findMany).not.toHaveBeenCalled();
    expect(db.patientMcsLink.findMany).not.toHaveBeenCalled();
    expect(db.communicationEvent.findMany).not.toHaveBeenCalled();
    expect(db.patientShareCase.findMany).not.toHaveBeenCalled();
    expect(db.task.findMany).not.toHaveBeenCalled();
    expect(db.billingEvidence.findMany).not.toHaveBeenCalled();
  });

  it('builds deterministic sections, rollups, next actions, and encoded action hrefs', async () => {
    const db = buildDb();
    const patientId = 'patient/with space?x=1';
    db.careCase.findFirst.mockResolvedValue(baseCase(patientId));
    db.consentRecord.findFirst.mockResolvedValue(null);
    db.managementPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      next_review_date: new Date('2026-07-01T00:00:00.000Z'),
    });
    db.firstVisitDocument.findFirst.mockResolvedValue(null);
    db.visitSchedule.findMany.mockResolvedValue([
      {
        id: 'schedule/1',
        display_id: 'VS-001',
        schedule_status: 'in_preparation',
        scheduled_date: new Date('2026-07-07T00:00:00.000Z'),
        carry_items_status: 'blocked',
        preparation: {
          id: 'prep_1',
          medication_changes_reviewed: false,
          carry_items_confirmed: false,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: false,
        },
        visit_record: { id: 'record_1' },
      },
    ]);
    db.careReport.findMany.mockResolvedValue([
      {
        id: 'report_1',
        display_id: 'REP-001',
        status: 'failed',
        updated_at: new Date('2026-07-05T00:00:00.000Z'),
      },
    ]);
    db.dispenseTask.findMany.mockResolvedValue([
      {
        id: 'dispense/1',
        priority: 'normal',
        status: 'pending',
        assigned_to: 'user_3',
        due_date: null,
      },
    ]);
    db.prescriptionLine.findMany.mockResolvedValue([
      {
        id: 'line/1',
        drug_master_id: null,
        drug_resolution_status: 'code_not_found',
      },
    ]);
    db.notification.findMany.mockResolvedValue([
      {
        id: 'notification/1',
        type: 'urgent',
        event_type: 'medication_run_out',
        link: `/patients/${encodeURIComponent(patientId)}`,
        created_at: new Date('2026-07-05T01:00:00.000Z'),
        title: '患者 太郎様の通知',
        message: '患者 太郎様の詳細本文',
      },
    ]);
    db.residence.findMany.mockResolvedValue([
      {
        id: 'residence/1',
        lat: 0,
        lng: 0,
        geocode_status: 'review_required',
        geocode_accuracy: 'low',
        updated_at: new Date('2026-07-05T02:00:00.000Z'),
        address: '東京都千代田区1-1-1',
      },
    ]);
    db.patientMcsLink.findMany.mockResolvedValue([
      {
        id: 'mcs_link/1',
        last_sync_status: 'failed',
        last_sync_attempt_at: new Date('2026-07-05T03:00:00.000Z'),
        last_synced_at: null,
        updated_at: new Date('2026-07-05T03:00:00.000Z'),
        last_sync_error: 'MCS raw provider error 患者 太郎',
        mcs_project_url: 'https://www.medical-care.net/projects/medical/123',
      },
    ]);
    db.communicationEvent.findMany.mockResolvedValue([
      {
        occurred_at: new Date('2026-07-05T03:30:00.000Z'),
        id: 'communication_event/1?x=1',
        subject: '患者 太郎 湿布が少ない',
        content: '湿布 残り4枚 090-1234-5678 storage_key=secret',
        counterpart_name: '訪問看護師 佐藤',
        counterpart_contact: '090-1234-5678',
        attachments: [{ storage_key: 's3://bucket/secret' }],
      },
    ]);
    db.patientShareCase.findMany.mockResolvedValue([
      {
        id: 'share/1',
        status: 'active',
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: true,
          download: true,
          note: '患者 太郎 外部共有 raw scope',
        },
        ends_at: null,
        updated_at: new Date('2026-07-05T04:00:00.000Z'),
        consents: [
          {
            id: 'share_consent_1',
            consent_date: new Date('2026-07-01T00:00:00.000Z'),
            valid_until: new Date('2026-07-31T00:00:00.000Z'),
            revoked_at: null,
            consent_person: '患者 太郎',
            file_asset_id: 'file_secret_1',
          },
        ],
        partnership: {
          partner_pharmacy: {
            name: '連携薬局 raw name',
          },
        },
      },
    ]);
    db.task.findMany.mockResolvedValue([
      {
        id: 'task/1',
        task_type: 'patient_foundation_review',
        title: '至急タスク',
        priority: 'urgent',
        status: 'pending',
        assigned_to: 'user_1',
        due_date: new Date('2026-07-06T00:00:00.000Z'),
        sla_due_at: new Date('2026-07-06T00:00:00.000Z'),
        related_entity_type: 'case',
        related_entity_id: 'case_1',
      },
      {
        id: 'task_other_patient',
        task_type: 'patient_foundation_review',
        title: '別患者タスク',
        priority: 'urgent',
        status: 'pending',
        assigned_to: 'user_2',
        due_date: null,
        sla_due_at: null,
        related_entity_type: 'patient',
        related_entity_id: 'patient_other',
      },
    ]);
    db.billingEvidence.findMany.mockResolvedValue([
      {
        id: 'bill_1',
        patient_id: patientId,
        visit_record_id: 'record_1',
        claimable: false,
        exclusion_reason: '報告書送付が未完了です',
        same_month_exclusion_flags: { report_delivery_incomplete: true },
        validation_notes: null,
      },
      {
        id: 'bill_other_record',
        patient_id: patientId,
        visit_record_id: 'record_other',
        claimable: false,
        exclusion_reason: '別記録',
        same_month_exclusion_flags: { missing_visit_consent: true },
        validation_notes: null,
      },
      {
        id: 'bill_other_patient_same_record',
        patient_id: 'patient_other',
        visit_record_id: 'record_1',
        claimable: false,
        exclusion_reason: '別患者',
        same_month_exclusion_flags: { missing_visit_consent: true },
        validation_notes: null,
      },
    ]);

    const result = await getCaseRiskCockpit(asDb(db), {
      orgId: 'org_1',
      caseId: 'case_1',
      userId: 'user_1',
      role: 'pharmacist',
      now: new Date('2026-07-06T00:00:00.000Z'),
    });

    expect(result).not.toBeNull();
    expect(result?.sections.map((section) => section.domain)).toEqual([
      'patient_foundation',
      'consent_plan',
      'medication',
      'dispensing',
      'visit_preparation',
      'visit_record',
      'report_delivery',
      'billing',
      'task_sla',
      'notification',
      'privacy_security',
      'integration',
      'data_quality',
    ]);
    expect(result?.overall).toMatchObject({
      status: 'blocked',
      blocking_count: 3,
      urgent_count: 6,
      warning_count: 6,
    });

    const findings = result?.sections.flatMap((section) => section.findings) ?? [];
    expect(findings.map((finding) => finding.key)).toEqual(
      expect.arrayContaining([
        'missing_visit_consent',
        'management_plan_review_overdue',
        'first_visit_document_not_delivered',
        'visit_carry_items_blocked:schedule/1',
        'visit_preparation_incomplete:schedule/1',
        'drug_master_reconciliation:line/1',
        'notification:notification/1',
        'residence_geocode:residence/1:zero_coordinates',
        'patient_mcs_sync:mcs_link/1',
        'inbound_interprofessional:pending',
        'patient_share_output_scope_review:share/1',
        'dispense_task:dispense/1',
        'report_delivery_failed:report_1',
        'task:task/1',
        'billing:bill_1:report_delivery_incomplete',
      ]),
    );
    expect(findings.map((finding) => finding.key)).not.toContain('task:task_other_patient');
    expect(findings.map((finding) => finding.key)).not.toContain(
      'billing:bill_other_record:missing_visit_consent',
    );
    expect(findings.map((finding) => finding.key)).not.toContain(
      'billing:bill_other_patient_same_record:missing_visit_consent',
    );
    expect(JSON.stringify(result)).not.toContain('至急タスク');
    expect(JSON.stringify(result)).not.toContain('患者 太郎様の通知');
    expect(JSON.stringify(result)).not.toContain('患者 太郎様の詳細本文');
    expect(JSON.stringify(result)).not.toContain('東京都千代田区1-1-1');
    expect(JSON.stringify(result)).not.toContain('MCS raw provider error');
    expect(JSON.stringify(result)).not.toContain('medical-care.net');
    expect(JSON.stringify(result)).not.toContain('communication_event');
    expect(JSON.stringify(result)).not.toContain('湿布');
    expect(JSON.stringify(result)).not.toContain('090-1234-5678');
    expect(JSON.stringify(result)).not.toContain('storage_key');
    expect(JSON.stringify(result)).not.toContain('外部共有 raw scope');
    expect(JSON.stringify(result)).not.toContain('連携薬局 raw name');
    expect(JSON.stringify(result)).not.toContain('file_secret_1');
    expect(JSON.stringify(result)).toContain('正本確認タスク');

    for (const finding of findings) {
      expect(finding.action_href).toMatch(/^\//);
      expect(finding.action_label.length).toBeGreaterThan(0);
      expect(finding.action_href).not.toContain(patientId);
    }
    expect(JSON.stringify(result)).toContain(encodeURIComponent(patientId));
    expect(JSON.stringify(result)).not.toContain('patient_other');
    expect(result?.next_actions.length).toBeGreaterThan(0);
    expect(result?.next_actions.every((action) => action.action_href.startsWith('/'))).toBe(true);
    expect(result?.next_actions.map((action) => action.task_id)).toContain('task/1');
    expect(result?.next_actions.map((action) => action.task_id)).not.toContain(
      'task_other_patient',
    );

    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: { in: ['pending', 'in_progress'] },
          OR: [
            { related_entity_type: 'case', related_entity_id: 'case_1' },
            { related_entity_type: 'patient', related_entity_id: patientId },
          ],
        }),
      }),
    );
    expect(db.dispenseTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: { in: ['pending', 'in_progress'] },
          cycle: {
            org_id: 'org_1',
            case_id: 'case_1',
            patient_id: patientId,
          },
        }),
      }),
    );
    expect(db.prescriptionLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          intake: {
            cycle: {
              org_id: 'org_1',
              case_id: 'case_1',
              patient_id: patientId,
            },
          },
        }),
      }),
    );
    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          user_id: 'user_1',
          is_read: false,
          type: 'urgent',
          OR: [
            { link: `/patients/${encodeURIComponent(patientId)}` },
            { link: { startsWith: `/patients/${encodeURIComponent(patientId)}/` } },
          ],
        }),
        select: {
          id: true,
          type: true,
          event_type: true,
          link: true,
          created_at: true,
        },
      }),
    );
    expect(db.residence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: patientId,
          is_primary: true,
        },
        select: {
          id: true,
          lat: true,
          lng: true,
          geocode_status: true,
          geocode_accuracy: true,
          updated_at: true,
        },
      }),
    );
    expect(db.patientMcsLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: patientId,
          AND: [{ last_sync_status: { not: null } }, { last_sync_status: { not: 'success' } }],
        },
        select: {
          id: true,
          last_sync_status: true,
          last_sync_attempt_at: true,
          last_synced_at: true,
          updated_at: true,
        },
      }),
    );
    expect(db.communicationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: patientId,
          direction: { in: ['inbound', 'incoming'] },
          channel: { in: ['phone', 'fax', 'email'] },
          AND: [
            { OR: [{ case_id: 'case_1' }, { case_id: null }] },
            { event_type: { not: 'patient_self_report' } },
          ],
        },
        orderBy: [{ occurred_at: 'desc' }],
        take: 1,
        select: {
          occurred_at: true,
        },
      }),
    );
    expect(db.patientShareCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          base_patient_id: patientId,
          status: 'active',
          OR: [{ base_case_id: 'case_1' }, { base_case_id: null }],
        },
        select: {
          id: true,
          status: true,
          share_scope: true,
          ends_at: true,
          updated_at: true,
          consents: {
            orderBy: [{ created_at: 'desc' }],
            take: 3,
            select: {
              id: true,
              consent_date: true,
              valid_until: true,
              revoked_at: true,
            },
          },
        },
      }),
    );
    expect(db.billingEvidence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          claimable: false,
          OR: [{ patient_id: null }, { patient_id: patientId }],
          visit_record_id: { in: ['record_1'] },
        }),
      }),
    );
  });

  it('uses Japan business date for management plan and task overdue rollups', async () => {
    const db = buildDb();
    db.careCase.findFirst.mockResolvedValue(baseCase());
    db.consentRecord.findFirst.mockResolvedValue({ id: 'consent_1', expiry_date: null });
    db.managementPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      next_review_date: new Date('2026-07-05T00:00:00.000Z'),
    });
    db.firstVisitDocument.findFirst.mockResolvedValue({
      id: 'doc_1',
      delivered_at: new Date('2026-07-01T00:00:00.000Z'),
    });
    db.visitSchedule.findMany.mockResolvedValue([]);
    db.careReport.findMany.mockResolvedValue([]);
    db.dispenseTask.findMany.mockResolvedValue([]);
    db.prescriptionLine.findMany.mockResolvedValue([]);
    db.notification.findMany.mockResolvedValue([]);
    db.residence.findMany.mockResolvedValue([]);
    db.patientMcsLink.findMany.mockResolvedValue([]);
    db.communicationEvent.findMany.mockResolvedValue([]);
    db.patientShareCase.findMany.mockResolvedValue([]);
    db.task.findMany.mockResolvedValue([
      {
        id: 'task_due_jst',
        task_type: 'patient_foundation_review',
        title: '期限タスク',
        priority: 'normal',
        status: 'pending',
        assigned_to: null,
        due_date: new Date('2026-07-05T00:00:00.000Z'),
        sla_due_at: null,
        related_entity_type: 'case',
        related_entity_id: 'case_1',
      },
    ]);
    db.billingEvidence.findMany.mockResolvedValue([]);

    const result = await getCaseRiskCockpit(asDb(db), {
      orgId: 'org_1',
      caseId: 'case_1',
      userId: 'user_1',
      role: 'pharmacist',
      now: new Date('2026-07-05T15:30:00.000Z'),
    });

    const findings = result?.sections.flatMap((section) => section.findings) ?? [];
    expect(findings.map((finding) => finding.key)).toContain('management_plan_review_overdue');
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'task:task_due_jst',
          severity: 'urgent',
        }),
      ]),
    );
    expect(result?.overall.status).toBe('blocked');
  });
});
