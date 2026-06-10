import { describe, expect, it, vi } from 'vitest';
import { ActionCode, CurrentStep, UserRole } from '@/phos/contracts/phos_contracts';
import { buildLogEntry, hashLogIdentifier, logPhosEvent } from './structured-logger';
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
          key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
          sha256: 'a'.repeat(64),
          checksum_sha256: 'checksum',
          mime_type: 'image/jpeg',
          size_bytes: 1024,
          authorization: 'Bearer secret',
          api_key: 'secret-key',
          card_id: 'card_detail_1',
          packet_id: 'packet_1',
          handoff_id: 'handoff_1',
          idempotency_key: 'idem_1',
          nested_ids: { delivery_id: 'delivery_1' },
          safe_count: 1,
        },
      }),
    ).toEqual({
      level: 'INFO',
      message: 'Action executed',
      tenant_id_hash: hashLogIdentifier('tenant_abc123'),
      user_id_hash: hashLogIdentifier('user_001'),
      request_id: 'req_1',
      correlation_id: 'corr_1',
      route_key: 'POST /cards/{card_id}/actions',
      action_code: ActionCode.APPROVE_SET_AUDIT,
      card_id_hash: hashLogIdentifier('card_001'),
      current_step: CurrentStep.SET_AUDIT,
      latency_ms: 87,
      details: {
        patient_name: '[REDACTED]',
        nested: { medication_name: '[REDACTED]' },
        key: '[REDACTED]',
        sha256: '[REDACTED]',
        checksum_sha256: '[REDACTED]',
        mime_type: '[REDACTED]',
        size_bytes: '[REDACTED]',
        authorization: '[REDACTED]',
        api_key: '[REDACTED]',
        card_id: hashLogIdentifier('card_detail_1'),
        packet_id: hashLogIdentifier('packet_1'),
        handoff_id: hashLogIdentifier('handoff_1'),
        idempotency_key: hashLogIdentifier('idem_1'),
        nested_ids: { delivery_id: hashLogIdentifier('delivery_1') },
        safe_count: 1,
      },
    });
  });

  it('writes JSON logs to stdout for info events', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const entry = buildLogEntry({ level: 'INFO', message: 'ok', ctx, route_key: 'GET /cards' });

    logPhosEvent(entry);

    expect(spy).toHaveBeenCalledWith(JSON.stringify(entry));
    expect(String(spy.mock.calls[0]?.[0])).not.toContain('tenant_abc123');
    expect(String(spy.mock.calls[0]?.[0])).not.toContain('user_001');
    spy.mockRestore();
  });
});
