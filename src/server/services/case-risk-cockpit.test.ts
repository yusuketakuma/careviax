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
    db.task.findMany.mockResolvedValue([
      {
        id: 'task/1',
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
      urgent_count: 2,
      warning_count: 3,
    });

    const findings = result?.sections.flatMap((section) => section.findings) ?? [];
    expect(findings.map((finding) => finding.key)).toEqual(
      expect.arrayContaining([
        'missing_visit_consent',
        'management_plan_review_overdue',
        'first_visit_document_not_delivered',
        'visit_carry_items_blocked:schedule/1',
        'visit_preparation_incomplete:schedule/1',
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
    db.task.findMany.mockResolvedValue([
      {
        id: 'task_due_jst',
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
