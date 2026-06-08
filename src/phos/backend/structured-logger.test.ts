import { describe, expect, it, vi } from 'vitest';
import { ActionCode, CurrentStep, UserRole } from '@/phos/contracts/phos_contracts';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import type { TenantContext } from './tenant-context';

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_001',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/cards.write'],
};

describe('PH-OS structured logger', () => {
  it('builds the required CloudWatch log shape and redacts PHI-like details', () => {
    expect(
      buildLogEntry({
        level: 'INFO',
        message: 'Action executed',
        ctx,
        route_key: 'POST /cards/{card_id}/actions',
        action_code: ActionCode.APPROVE_SET_AUDIT,
        card_id: 'card_001',
        current_step: CurrentStep.SET_AUDIT,
        latency_ms: 87,
        details: {
          patient_name: '山田太郎',
          nested: { medication_name: '薬剤名' },
          safe_count: 1,
        },
      }),
    ).toEqual({
      level: 'INFO',
      message: 'Action executed',
      tenant_id: 'tenant_abc123',
      user_id: 'user_001',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      route_key: 'POST /cards/{card_id}/actions',
      action_code: ActionCode.APPROVE_SET_AUDIT,
      card_id: 'card_001',
      current_step: CurrentStep.SET_AUDIT,
      latency_ms: 87,
      details: {
        patient_name: '[REDACTED]',
        nested: { medication_name: '[REDACTED]' },
        safe_count: 1,
      },
    });
  });

  it('writes JSON logs to stdout for info events', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const entry = buildLogEntry({ level: 'INFO', message: 'ok', ctx, route_key: 'GET /cards' });

    logPhosEvent(entry);

    expect(spy).toHaveBeenCalledWith(JSON.stringify(entry));
    spy.mockRestore();
  });
});
