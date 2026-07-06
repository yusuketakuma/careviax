import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waiveRiskOperationalTaskById } from './risk-task-resolution';

const auditLogCreateMock = vi.fn();
const taskCreateMock = vi.fn();
const taskFindFirstMock = vi.fn();
const taskFindManyMock = vi.fn();
const taskUpdateManyMock = vi.fn();
const taskUpsertMock = vi.fn();

const ctx = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist' as const,
};

function riskTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task_1',
    task_type: 'risk_billing',
    display_id: 'tsk0000000001',
    status: 'pending',
    dedupe_key:
      'risk:billing:billing%3Abill_1%3Amissing_visit_consent:case:case_1:billing_evidence:bill_1',
    related_entity_type: 'billing_evidence',
    related_entity_id: 'bill_1',
    metadata: {
      source: 'risk_finding',
      risk_domain: 'billing',
      risk_key: 'billing:bill_1:missing_visit_consent',
      risk_severity: 'blocking',
      risk_source: 'computed',
      action_href: '/billing/close-board?evidence_id=bill_1',
      related_entity_type: 'billing_evidence',
      related_entity_id: 'bill_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
    },
    ...overrides,
  };
}

function tx() {
  return {
    auditLog: {
      create: auditLogCreateMock,
    },
    task: {
      create: taskCreateMock,
      findFirst: taskFindFirstMock,
      findMany: taskFindManyMock,
      updateMany: taskUpdateManyMock,
      upsert: taskUpsertMock,
    },
  };
}

describe('waiveRiskOperationalTaskById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    taskFindFirstMock.mockResolvedValue(riskTask());
    taskFindManyMock.mockResolvedValue([{ id: 'task_1', metadata: { source: 'risk_finding' } }]);
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it('waives a risk task through audit-first cancellation scoped by task id', async () => {
    const result = await waiveRiskOperationalTaskById(tx(), {
      orgId: 'org_1',
      caseId: 'case_1',
      taskId: 'task_1',
      ctx,
      waiverReason: '薬剤師確認により免除',
      reasonCode: 'pharmacist_override',
    });

    expect(result).toMatchObject({
      status: 'waived',
      task_id: 'task_1',
      display_id: 'tsk0000000001',
      case_id: 'case_1',
      risk_domain: 'billing',
      updated_task_count: 1,
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'risk_finding_waived',
          target_type: 'risk_finding',
          target_id:
            'risk:billing:billing%3Abill_1%3Amissing_visit_consent:case:case_1:billing_evidence:bill_1',
          patient_id: 'patient_1',
        }),
      }),
    );
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'task_1',
          org_id: 'org_1',
          dedupe_key:
            'risk:billing:billing%3Abill_1%3Amissing_visit_consent:case:case_1:billing_evidence:bill_1',
          task_type: 'risk_billing',
          related_entity_type: 'billing_evidence',
          related_entity_id: 'bill_1',
        }),
      }),
    );
    expect(taskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'task_1',
          org_id: 'org_1',
        }),
        data: expect.objectContaining({
          status: 'cancelled',
          completed_at: null,
          metadata: expect.objectContaining({
            resolution: expect.objectContaining({
              state: 'waived',
              audit_log_id: 'audit_1',
              reason_code: 'pharmacist_override',
              reason_present: true,
              reason_redacted: true,
            }),
          }),
        }),
      }),
    );
  });

  it('does not persist raw waiver reason or PHI-like finding text in audit or task metadata', async () => {
    await waiveRiskOperationalTaskById(tx(), {
      orgId: 'org_1',
      caseId: 'case_1',
      taskId: 'task_1',
      ctx,
      waiverReason: '患者 山田花子 090-1234-5678 アムロジピン raw reason',
    });

    const serialized = JSON.stringify([
      auditLogCreateMock.mock.calls,
      taskUpdateManyMock.mock.calls,
    ]);
    expect(serialized).not.toContain('山田花子');
    expect(serialized).not.toContain('090-1234-5678');
    expect(serialized).not.toContain('アムロジピン');
    expect(serialized).not.toContain('raw reason');
  });

  it('returns invalid_risk_task for non-risk tasks or malformed risk metadata', async () => {
    taskFindFirstMock.mockResolvedValueOnce(riskTask({ task_type: 'visit_preparation' }));

    await expect(
      waiveRiskOperationalTaskById(tx(), {
        orgId: 'org_1',
        caseId: 'case_1',
        taskId: 'task_1',
        ctx,
        waiverReason: '理由',
      }),
    ).resolves.toEqual({ status: 'invalid_risk_task' });

    taskFindFirstMock.mockResolvedValueOnce(riskTask({ metadata: { source: 'risk_finding' } }));
    await expect(
      waiveRiskOperationalTaskById(tx(), {
        orgId: 'org_1',
        caseId: 'case_1',
        taskId: 'task_1',
        ctx,
        waiverReason: '理由',
      }),
    ).resolves.toEqual({ status: 'invalid_risk_task' });
  });

  it('rejects risk task metadata that belongs to another case', async () => {
    taskFindFirstMock.mockResolvedValueOnce(riskTask());

    await expect(
      waiveRiskOperationalTaskById(tx(), {
        orgId: 'org_1',
        caseId: 'case_other',
        taskId: 'task_1',
        ctx,
        waiverReason: '理由',
      }),
    ).resolves.toEqual({ status: 'invalid_risk_task' });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns conflict when the task is already closed or the cancellation claim loses a race', async () => {
    taskFindFirstMock.mockResolvedValueOnce(riskTask({ status: 'completed' }));

    await expect(
      waiveRiskOperationalTaskById(tx(), {
        orgId: 'org_1',
        caseId: 'case_1',
        taskId: 'task_1',
        ctx,
        waiverReason: '理由',
      }),
    ).resolves.toEqual({ status: 'conflict' });

    taskFindFirstMock.mockResolvedValueOnce(riskTask());
    taskUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    await expect(
      waiveRiskOperationalTaskById(tx(), {
        orgId: 'org_1',
        caseId: 'case_1',
        taskId: 'task_1',
        ctx,
        waiverReason: '理由',
      }),
    ).resolves.toEqual({ status: 'conflict' });
  });
});
