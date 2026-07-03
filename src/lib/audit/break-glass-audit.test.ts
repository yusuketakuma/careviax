import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  recordBreakGlassAudit,
  BREAK_GLASS_READ_ACTION,
  type BreakGlassAuditInput,
} from './break-glass-audit';

function baseInput(overrides: Partial<BreakGlassAuditInput> = {}): BreakGlassAuditInput {
  return {
    sessionId: 'bg_1',
    operatorUserId: 'user_1',
    targetOrgId: 'org_target',
    action: BREAK_GLASS_READ_ACTION,
    targetType: 'patient',
    targetId: 'patient_1',
    reason: 'incident-4711',
    scope: 'read_only',
    ipAddress: '203.0.113.5',
    userAgent: 'vitest-ua',
    ...overrides,
  };
}

describe('recordBreakGlassAudit', () => {
  it('writes an AuditLog row scoped to the target org with operator as actor', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_1' });

    await recordBreakGlassAudit({ auditLog: { create } }, baseInput({ patientId: 'patient_1' }));

    expect(create).toHaveBeenCalledWith({
      data: {
        org_id: 'org_target',
        actor_id: 'user_1',
        actor_pharmacy_id: 'org_target',
        patient_id: 'patient_1',
        action: BREAK_GLASS_READ_ACTION,
        target_type: 'patient',
        target_id: 'patient_1',
        changes: {
          break_glass_session_id: 'bg_1',
          reason: 'incident-4711',
          scope: 'read_only',
        },
        ip_address: '203.0.113.5',
        user_agent: 'vitest-ua',
      },
    });
  });

  it('nests non-PHI metadata under changes.metadata when provided', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_2' });

    await recordBreakGlassAudit(
      { auditLog: { create } },
      baseInput({ metadata: { table: 'visits', row_count: 12 } }),
    );

    const changes = create.mock.calls[0]?.[0]?.data?.changes as Record<string, unknown>;
    expect(changes).toEqual({
      break_glass_session_id: 'bg_1',
      reason: 'incident-4711',
      scope: 'read_only',
      metadata: { table: 'visits', row_count: 12 },
    });
  });

  it('never records PHI body values — only session id, reason, scope (+optional metadata)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_3' });

    await recordBreakGlassAudit({ auditLog: { create } }, baseInput());

    const changes = create.mock.calls[0]?.[0]?.data?.changes as Record<string, unknown>;
    expect(Object.keys(changes).sort()).toEqual(['break_glass_session_id', 'reason', 'scope']);
  });

  it('is fail-closed: it re-throws when the audit write fails (does NOT swallow)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));

    await expect(
      recordBreakGlassAudit({ auditLog: { create } }, baseInput()),
    ).rejects.toThrow('db down');
  });
});
