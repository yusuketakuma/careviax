import { describe, expect, it, vi } from 'vitest';
import { createRiskFinding } from '@/lib/risk/risk-finding';
import { syncOperationalTasksForRiskFindings } from './case-risk-task-sync';

function tx() {
  return {
    task: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
}

describe('case-risk-task-sync', () => {
  it('upserts only taskable risks with PHI-minimized task payloads', async () => {
    const db = tx();
    db.task.upsert.mockResolvedValue({ id: 'task_1', display_id: 'tsk0000000001' });

    const result = await syncOperationalTasksForRiskFindings(db, {
      orgId: 'org_1',
      findings: [
        createRiskFinding({
          key: 'patient_share_missing_active_consent:share_1',
          domain: 'privacy_security',
          severity: 'urgent',
          title: '患者 山田花子 raw title',
          detail: '東京都千代田区1-1-1 090-1234-5678 raw detail',
          patient_id: 'patient_1',
          case_id: 'case_1',
          related_entity_type: 'patient_share_case',
          related_entity_id: 'share_1',
          due_at: '2026-07-06T00:00:00.000Z',
          action_href: '/patients/patient_1/share',
          action_label: '共有設定を確認',
        }),
        createRiskFinding({
          key: 'patient_share_output_scope_review:share_1',
          domain: 'privacy_security',
          severity: 'warning',
          title: 'warning',
          detail: 'warning',
          patient_id: 'patient_1',
          case_id: 'case_1',
          related_entity_type: 'patient_share_case',
          related_entity_id: 'share_1',
          action_href: '/patients/patient_1/share',
          action_label: '共有設定を確認',
        }),
        createRiskFinding({
          key: 'task:task_1',
          domain: 'task_sla',
          severity: 'urgent',
          title: 'recursive',
          detail: 'recursive',
          related_entity_type: 'task',
          related_entity_id: 'task_1',
          action_href: '/tasks/task_1',
          action_label: 'タスクを確認',
        }),
      ],
    });

    expect(result).toEqual({
      taskable_finding_count: 1,
      skipped_finding_count: 2,
      upserted_task_count: 1,
      upserted_tasks: [{ id: 'task_1', display_id: 'tsk0000000001' }],
    });
    expect(db.task.upsert).toHaveBeenCalledOnce();
    const call = db.task.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({
      org_id: 'org_1',
      task_type: 'risk_privacy_security',
      title: 'PII・監査の対応',
      description: 'PII・監査の未解決リスクを確認し、対応状況を更新してください。',
      priority: 'urgent',
      related_entity_type: 'patient_share_case',
      related_entity_id: 'share_1',
      status: 'pending',
    });
    expect(call.create.metadata).toMatchObject({
      source: 'risk_finding',
      risk_domain: 'privacy_security',
      risk_key: 'patient_share_missing_active_consent:share_1',
      action_href: '/patients/patient_1/share',
      case_id: 'case_1',
      patient_id: 'patient_1',
    });
    expect(JSON.stringify(call)).not.toContain('山田花子');
    expect(JSON.stringify(call)).not.toContain('東京都千代田区');
    expect(JSON.stringify(call)).not.toContain('090-1234-5678');
    expect(JSON.stringify(call)).not.toContain('raw detail');
  });
});
