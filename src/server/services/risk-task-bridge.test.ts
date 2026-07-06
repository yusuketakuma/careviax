import { describe, expect, it, vi } from 'vitest';
import { createRiskFinding, type RiskFinding } from '@/lib/risk/risk-finding';
import {
  buildRiskTaskWaiverAuditChanges,
  riskFindingToOperationalTaskInput,
  riskFindingToResolveOperationalTaskInput,
  riskFindingToWaiveOperationalTaskInput,
  shouldCreateOperationalTaskForRisk,
  waiveOperationalTaskForRiskWithAudit,
} from './risk-task-bridge';
import { adaptOperationalTaskToRiskFinding } from './risk-finding-registry';

function finding(overrides: Partial<RiskFinding> = {}): RiskFinding {
  return createRiskFinding({
    key: overrides.key ?? 'billing:bill_1:missing_visit_consent',
    domain: overrides.domain ?? 'billing',
    severity: overrides.severity ?? 'blocking',
    title: overrides.title ?? '患者 山田花子 アムロジピン raw title',
    detail: overrides.detail ?? '東京都千代田区1-1-1 090-1234-5678 raw detail',
    patient_id: overrides.patient_id ?? 'patient_1',
    case_id: overrides.case_id ?? 'case_1',
    related_entity_type: overrides.related_entity_type ?? 'billing_evidence',
    related_entity_id: overrides.related_entity_id ?? 'bill_1',
    assigned_to: overrides.assigned_to ?? 'user_1',
    due_at: overrides.due_at ?? '2026-07-07T00:00:00.000Z',
    action_href: overrides.action_href ?? '/billing/close-board?evidence_id=bill_1',
    action_label: overrides.action_label ?? '算定を確認',
    resolution_state: overrides.resolution_state,
    source: overrides.source,
  });
}

function medicationStockFinding(
  overrides: {
    riskCode?: string;
    severity?: RiskFinding['severity'];
    title?: string;
    detail?: string;
  } = {},
): RiskFinding {
  const riskCode = overrides.riskCode ?? 'medication_stock_urgent_shortage';
  return createRiskFinding({
    key: `medication_stock:${riskCode}:h1234567890abcdef`,
    domain: 'medication',
    severity: overrides.severity ?? 'urgent',
    title: overrides.title ?? '患者 山田花子 湿布 raw title',
    detail: overrides.detail ?? 'MCS本文 湿布は残り4枚です raw detail',
    patient_id: 'patient_1',
    case_id: 'case_1',
    related_entity_type: 'inbound_medication_stock_signal',
    related_entity_id: null,
    action_href: '/patients/patient_1#medication-stock-events',
    action_label: '残数報告を確認',
    source: 'external',
  });
}

describe('risk-task-bridge', () => {
  it('taskifies only active blocking or urgent findings', () => {
    expect(shouldCreateOperationalTaskForRisk(finding({ severity: 'blocking' }))).toBe(true);
    expect(shouldCreateOperationalTaskForRisk(finding({ severity: 'urgent' }))).toBe(true);
    expect(shouldCreateOperationalTaskForRisk(finding({ severity: 'warning' }))).toBe(false);
    expect(
      shouldCreateOperationalTaskForRisk(
        medicationStockFinding({
          riskCode: 'medication_stock_external_observation_review_required',
          severity: 'warning',
        }),
      ),
    ).toBe(true);
    expect(shouldCreateOperationalTaskForRisk(finding({ severity: 'info' }))).toBe(false);
    expect(
      shouldCreateOperationalTaskForRisk(
        finding({ severity: 'blocking', resolution_state: 'resolved' }),
      ),
    ).toBe(false);
    expect(
      shouldCreateOperationalTaskForRisk(
        finding({ severity: 'urgent', resolution_state: 'waived' }),
      ),
    ).toBe(false);
    expect(shouldCreateOperationalTaskForRisk(finding({ domain: 'task_sla' }))).toBe(false);
  });

  it('does not recursively taskify operational task SLA findings', () => {
    const taskFinding = adaptOperationalTaskToRiskFinding(
      {
        id: 'task_1',
        task_type: 'risk_billing',
        title: 'raw title',
        priority: 'urgent',
        status: 'pending',
        assigned_to: null,
        due_date: null,
        sla_due_at: new Date('2026-07-05T00:00:00.000Z'),
        related_entity_type: 'billing_evidence',
        related_entity_id: 'bill_1',
      },
      { now: new Date('2026-07-06T00:00:00.000Z') },
    );

    expect(taskFinding).toMatchObject({ domain: 'task_sla', severity: 'urgent' });
    expect(riskFindingToOperationalTaskInput({ orgId: 'org_1', finding: taskFinding })).toBeNull();
  });

  it('builds PHI-minimized upsert input with stable dedupe and related entity', () => {
    const input = riskFindingToOperationalTaskInput({
      orgId: 'org_1',
      finding: finding({ key: 'billing:bill/1:missing_visit_consent' }),
    });

    expect(input).toMatchObject({
      orgId: 'org_1',
      taskType: 'risk_billing',
      title: '算定・請求の対応',
      description: '算定・請求の未解決リスクを確認し、対応状況を更新してください。',
      priority: 'urgent',
      assignedTo: 'user_1',
      dedupeKey:
        'risk:billing:billing%3Abill%2F1%3Amissing_visit_consent:case:case_1:billing_evidence:bill_1',
      relatedEntityType: 'billing_evidence',
      relatedEntityId: 'bill_1',
      status: 'pending',
    });
    expect(input?.dueDate?.toISOString()).toBe('2026-07-07T00:00:00.000Z');
    expect(input?.slaDueAt?.toISOString()).toBe('2026-07-07T00:00:00.000Z');
    expect(JSON.stringify(input)).not.toContain('山田花子');
    expect(JSON.stringify(input)).not.toContain('東京都千代田区1-1-1');
    expect(JSON.stringify(input)).not.toContain('090-1234-5678');
    expect(JSON.stringify(input)).not.toContain('アムロジピン');
  });

  it('taskifies medication stock findings into dedicated pharmacy task types', () => {
    const cases = [
      {
        riskCode: 'medication_stock_urgent_shortage',
        taskType: 'pharmacy.medication_stock_shortage_expected',
        title: '残数不足見込み',
        description: '外用薬・頓服薬の不足見込みを確認する。',
      },
      {
        riskCode: 'medication_stock_usage_report_review_required',
        taskType: 'pharmacy.medication_stock_usage_unknown',
        title: '使用頻度未確認',
        description: '外用薬・頓服薬の使用頻度不明を確認する。',
      },
      {
        riskCode: 'medication_stock_equivalence_review_required',
        taskType: 'pharmacy.medication_stock_equivalence_review_required',
        title: '薬剤名寄せ確認',
        description: '外用薬・頓服薬の薬剤マスタ照合または名寄せ確認を行う。',
      },
      {
        riskCode: 'medication_stock_external_observation_review_required',
        taskType: 'pharmacy.medication_stock_external_observation_review_required',
        title: '他職種残数報告',
        description: '他職種・患者家族・協力薬局由来の外用薬・頓服薬残数報告を薬剤師が確認する。',
      },
    ] as const;

    for (const testCase of cases) {
      const input = riskFindingToOperationalTaskInput({
        orgId: 'org_1',
        finding: medicationStockFinding({
          riskCode: testCase.riskCode,
          severity: testCase.riskCode === 'medication_stock_urgent_shortage' ? 'urgent' : 'warning',
          title: '患者 山田花子 湿布 raw title',
          detail: 'MCS本文 湿布は残り4枚です raw detail',
        }),
      });

      expect(input).toMatchObject({
        taskType: testCase.taskType,
        title: testCase.title,
        description: testCase.description,
        relatedEntityType: 'patient',
        relatedEntityId: 'patient_1',
      });
      expect(input?.dedupeKey).toBe(
        `risk:medication:medication_stock%3A${testCase.riskCode}%3Ah1234567890abcdef:case:case_1`,
      );

      const serialized = JSON.stringify(input);
      expect(serialized).not.toContain('山田花子');
      expect(serialized).not.toContain('湿布は残り4枚');
      expect(serialized).not.toContain('raw title');
      expect(serialized).not.toContain('raw detail');
      expect(serialized).not.toContain('inbound_signal_1');
    }
  });

  it('resolves medication stock tasks with the same dedicated task identity', () => {
    const stockFinding = medicationStockFinding();

    expect(
      riskFindingToResolveOperationalTaskInput({
        orgId: 'org_1',
        finding: stockFinding,
      }),
    ).toMatchObject({
      orgId: 'org_1',
      taskType: 'pharmacy.medication_stock_shortage_expected',
      dedupeKey:
        'risk:medication:medication_stock%3Amedication_stock_urgent_shortage%3Ah1234567890abcdef:case:case_1',
      relatedEntityType: 'patient',
      relatedEntityId: 'patient_1',
      status: 'completed',
    });
  });

  it('drops invalid due dates instead of passing invalid Date objects', () => {
    const input = riskFindingToOperationalTaskInput({
      orgId: 'org_1',
      finding: finding({ due_at: 'not-a-date' }),
    });

    expect(input?.dueDate).toBeNull();
    expect(input?.slaDueAt).toBeNull();
  });

  it('returns null for non-taskable findings', () => {
    expect(
      riskFindingToOperationalTaskInput({
        orgId: 'org_1',
        finding: finding({ severity: 'warning' }),
      }),
    ).toBeNull();
  });

  it('builds resolve input from the same dedupe identity for resolved findings', () => {
    expect(
      riskFindingToResolveOperationalTaskInput({
        orgId: 'org_1',
        finding: finding({ resolution_state: 'resolved' }),
      }),
    ).toMatchObject({
      orgId: 'org_1',
      taskType: 'risk_billing',
      dedupeKey:
        'risk:billing:billing%3Abill_1%3Amissing_visit_consent:case:case_1:billing_evidence:bill_1',
      relatedEntityType: 'billing_evidence',
      relatedEntityId: 'bill_1',
      status: 'completed',
    });
  });

  it('requires audit context before cancelling waived findings', () => {
    const waived = finding({ resolution_state: 'waived' });
    expect(
      riskFindingToWaiveOperationalTaskInput({
        orgId: 'org_1',
        finding: waived,
        actorUserId: 'user_1',
        waiverReason: '薬剤師確認のうえ免除',
        auditLogId: 'audit_1',
      }),
    ).toMatchObject({ status: 'cancelled' });
    expect(() =>
      riskFindingToWaiveOperationalTaskInput({
        orgId: 'org_1',
        finding: waived,
        actorUserId: 'user_1',
        waiverReason: '',
        auditLogId: 'audit_1',
      }),
    ).toThrow('Risk task waiver requires waiverReason');
    expect(() =>
      riskFindingToWaiveOperationalTaskInput({
        orgId: 'org_1',
        finding: waived,
        actorUserId: '',
        waiverReason: '薬剤師確認のうえ免除',
        auditLogId: 'audit_1',
      }),
    ).toThrow('Risk task waiver requires actorUserId');
    expect(() =>
      riskFindingToWaiveOperationalTaskInput({
        orgId: 'org_1',
        finding: waived,
        actorUserId: 'user_1',
        waiverReason: '薬剤師確認のうえ免除',
        auditLogId: '',
      }),
    ).toThrow('Risk task waiver requires auditLogId');
  });

  it('builds waiver resolve input with redacted resolution note metadata', () => {
    const waived = finding({ resolution_state: 'waived' });

    const input = riskFindingToWaiveOperationalTaskInput({
      orgId: 'org_1',
      finding: waived,
      actorUserId: 'user_1',
      waiverReason: '患者 山田花子 raw waiver reason 090-1234-5678',
      reasonCode: 'pharmacist_override',
      auditLogId: 'audit_1',
    });

    expect(input).toMatchObject({
      status: 'cancelled',
      resolution: {
        state: 'waived',
        actorUserId: 'user_1',
        auditLogId: 'audit_1',
        reasonPresent: true,
        reasonLength: '患者 山田花子 raw waiver reason 090-1234-5678'.length,
        reasonCode: 'pharmacist_override',
      },
    });
    expect(JSON.stringify(input)).not.toContain('山田花子');
    expect(JSON.stringify(input)).not.toContain('090-1234-5678');
    expect(JSON.stringify(input)).not.toContain('raw waiver reason');
  });

  it('builds PHI-minimized waiver audit changes without storing title/detail/reason text', () => {
    const waived = finding({ resolution_state: 'waived' });

    const changes = buildRiskTaskWaiverAuditChanges({
      finding: waived,
      waiverReason: '患者 山田花子 raw waiver reason 090-1234-5678',
      reasonCode: 'pharmacist_override',
    });

    expect(changes).toMatchObject({
      risk_domain: 'billing',
      risk_severity: 'blocking',
      risk_resolution_state: 'waived',
      task_resolution_status: 'cancelled',
      related_entity_type: 'billing_evidence',
      related_entity_id: 'bill_1',
      case_id: 'case_1',
      reason_code: 'pharmacist_override',
      reason_present: true,
      reason_length: '患者 山田花子 raw waiver reason 090-1234-5678'.length,
      reason_redacted: true,
    });
    const serialized = JSON.stringify(changes);
    expect(serialized).not.toContain('山田花子');
    expect(serialized).not.toContain('090-1234-5678');
    expect(serialized).not.toContain('raw waiver reason');
    expect(serialized).not.toContain('アムロジピン');
    expect(serialized).not.toContain('東京都千代田区');
  });

  it('writes waiver audit before cancelling the task with the returned audit id', async () => {
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit_1' });
    const taskUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const taskFindMany = vi.fn().mockResolvedValue([
      {
        id: 'task_1',
        metadata: {
          source: 'risk_finding',
          risk_domain: 'billing',
        },
      },
    ]);
    const tx = {
      auditLog: { create: auditCreate },
      task: {
        create: vi.fn(),
        updateMany: taskUpdateMany,
        upsert: vi.fn(),
        findMany: taskFindMany,
      },
    };

    const result = await waiveOperationalTaskForRiskWithAudit(tx, {
      orgId: 'org_1',
      finding: finding({ resolution_state: 'waived' }),
      waiverReason: '薬剤師確認のうえ免除',
      reasonCode: 'pharmacist_override',
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        actorSiteId: 'site_1',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
    });

    expect(result).toEqual({ count: 1 });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_site_id: 'site_1',
        patient_id: 'patient_1',
        action: 'risk_finding_waived',
        target_type: 'risk_finding',
        target_id:
          'risk:billing:billing%3Abill_1%3Amissing_visit_consent:case:case_1:billing_evidence:bill_1',
        changes: expect.objectContaining({
          risk_resolution_state: 'waived',
          reason_present: true,
          reason_redacted: true,
        }),
      }),
    });
    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'cancelled',
          metadata: expect.objectContaining({
            resolution: expect.objectContaining({
              state: 'waived',
              actor_user_id: 'user_1',
              audit_log_id: 'audit_1',
              reason_code: 'pharmacist_override',
              reason_present: true,
              reason_redacted: true,
            }),
          }),
        }),
      }),
    );
    const serializedCalls = JSON.stringify({
      audit: auditCreate.mock.calls,
      task: taskUpdateMany.mock.calls,
    });
    expect(serializedCalls).not.toContain('山田花子');
    expect(serializedCalls).not.toContain('090-1234-5678');
    expect(serializedCalls).not.toContain('raw detail');
  });

  it('throws after audit when waiver does not update exactly one task so the transaction can roll back', async () => {
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit_1' });
    const taskUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const taskFindMany = vi.fn().mockResolvedValue([
      {
        id: 'task_1',
        metadata: { source: 'risk_finding' },
      },
    ]);
    const tx = {
      auditLog: { create: auditCreate },
      task: {
        create: vi.fn(),
        updateMany: taskUpdateMany,
        upsert: vi.fn(),
        findMany: taskFindMany,
      },
    };

    await expect(
      waiveOperationalTaskForRiskWithAudit(tx, {
        orgId: 'org_1',
        finding: finding({ resolution_state: 'waived' }),
        waiverReason: '薬剤師確認のうえ免除',
        ctx: {
          orgId: 'org_1',
          userId: 'user_1',
        },
      }),
    ).rejects.toThrow('Risk task waiver did not update exactly one task');
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(taskUpdateMany).toHaveBeenCalledOnce();
  });
});
