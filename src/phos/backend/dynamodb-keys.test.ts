import { describe, expect, it } from 'vitest';
import {
  assertTenantGsiKey,
  assertTenantPk,
  assertTenantScopedDynamoOperation,
  assigneeGsiPk,
  boardGsiPk,
  boardGsiSk,
  cardActionIdempotencySk,
  cardBlockerSk,
  cardEventSk,
  cardSk,
  capacitySk,
  evidenceSk,
  handoffAssigneeGsiPk,
  handoffAssigneeGsiSk,
  handoffIdempotencySk,
  handoffSk,
  offlineOpSk,
  packetCardSk,
  packetGsiPk,
  packetGsiSk,
  patientGsiPk,
  reportDeliveryIdempotencySk,
  reportDeliverySk,
  reportDeliveryStatusGsiPk,
  reportDeliveryStatusGsiSk,
  tenantPk,
  TenantKeyError,
  userSk,
  visitPacketSk,
  visitStepIdempotencySk,
} from './dynamodb-keys';
import type { TenantContext } from './tenant-context';

const ctx = { tenant_id: 'tenant_abc123' } as TenantContext;

describe('PH-OS DynamoDB key contract', () => {
  it('builds tenant-scoped PK/SK values', () => {
    expect(tenantPk(ctx)).toBe('TENANT#tenant_abc123');
    expect(cardSk('card_001')).toBe('CARD#card_001');
    expect(
      cardEventSk({ card_id: 'card_001', created_at: '2026-06-08T00:00:00Z', event_id: 'evt_1' }),
    ).toBe('CARD_EVENT#card_001#2026-06-08T00:00:00Z#evt_1');
    expect(cardBlockerSk({ card_id: 'card_001', blocker_code: 'MISSING_EVIDENCE' })).toBe(
      'CARD_BLOCKER#card_001#MISSING_EVIDENCE',
    );
    expect(cardActionIdempotencySk({ card_id: 'card_001', idempotency_key: 'idem_1' })).toBe(
      'CARD_ACTION_IDEMPOTENCY#card_001#idem_1',
    );
    expect(visitPacketSk('packet_1')).toBe('VISIT_PACKET#packet_1');
    expect(packetCardSk({ packet_id: 'packet_1', card_id: 'card_001' })).toBe(
      'PACKET_CARD#packet_1#card_001',
    );
    expect(
      visitStepIdempotencySk({
        packet_id: 'packet_1',
        step: 'ARRIVAL_CONFIRM',
        idempotency_key: 'idem_1',
      }),
    ).toBe('VISIT_STEP_IDEMPOTENCY#packet_1#ARRIVAL_CONFIRM#idem_1');
    expect(evidenceSk('evidence_1')).toBe('EVIDENCE#evidence_1');
    expect(reportDeliverySk('delivery_1')).toBe('REPORT_DELIVERY#delivery_1');
    expect(capacitySk({ date: '2026-06-09', scope: 'PHARMACY' })).toBe(
      'CAPACITY#2026-06-09#PHARMACY',
    );
    expect(handoffSk('handoff_1')).toBe('HANDOFF#handoff_1');
    expect(
      handoffIdempotencySk({
        mutation_key: 'RESOLVE_HANDOFF:handoff_1',
        idempotency_key: 'idem_1',
      }),
    ).toBe('HANDOFF_IDEMPOTENCY#RESOLVE_HANDOFF:handoff_1#idem_1');
    expect(
      reportDeliveryIdempotencySk({
        mutation_key: 'REGISTER_REPORT_REPLY:delivery_1',
        idempotency_key: 'idem_1',
      }),
    ).toBe('REPORT_DELIVERY_IDEMPOTENCY#REGISTER_REPORT_REPLY:delivery_1#idem_1');
    expect(offlineOpSk('operation_1')).toBe('OFFLINE_OP#operation_1');
    expect(userSk('user_1')).toBe('USER#user_1');
  });

  it('builds tenant-prefixed GSI keys', () => {
    expect(boardGsiPk(ctx)).toBe('TENANT#tenant_abc123#BOARD');
    expect(
      boardGsiSk({ current_step: 'REPORT', due_at: '2026-06-08T00:00:00Z', card_id: 'card_1' }),
    ).toBe('STEP#REPORT#DUE#2026-06-08T00:00:00Z#CARD#card_1');
    expect(assigneeGsiPk(ctx, 'user_1')).toBe('TENANT#tenant_abc123#ASSIGNEE#user_1');
    expect(handoffAssigneeGsiPk(ctx, 'user_1')).toBe(
      'TENANT#tenant_abc123#HANDOFF_ASSIGNEE#user_1',
    );
    expect(reportDeliveryStatusGsiPk(ctx, 'WAITING_REPLY')).toBe(
      'TENANT#tenant_abc123#REPORT_DELIVERY_STATUS#WAITING_REPLY',
    );
    expect(
      reportDeliveryStatusGsiSk({
        stale_minutes: 90,
        sent_at: '2026-06-08T00:00:00Z',
        delivery_id: 'delivery_1',
      }),
    ).toBe('STALE#00000090#SENT#2026-06-08T00:00:00Z#DELIVERY#delivery_1');
    expect(
      handoffAssigneeGsiSk({
        status: 'OPEN',
        urgency_rank: 3,
        created_at: '2026-06-08T00:00:00Z',
        handoff_id: 'handoff_1',
      }),
    ).toBe('STATUS#OPEN#URGENCY#3#CREATED#2026-06-08T00:00:00Z#HANDOFF#handoff_1');
    expect(patientGsiPk(ctx, 'patient_1')).toBe('TENANT#tenant_abc123#PATIENT#patient_1');
    expect(packetGsiPk(ctx, 'packet_1')).toBe('TENANT#tenant_abc123#PACKET#packet_1');
    expect(packetGsiSk('card_1')).toBe('CARD#card_1');
  });

  it('rejects cross-tenant PK and GSI keys', () => {
    expect(() => assertTenantPk(ctx, 'TENANT#other')).toThrow(TenantKeyError);
    expect(() => assertTenantGsiKey(ctx, 'TENANT#other#BOARD')).toThrow(TenantKeyError);
  });

  it('forbids Scan and requires tenant-scoped Query partition keys', () => {
    expect(() => assertTenantScopedDynamoOperation(ctx, { operation: 'Scan' })).toThrow(
      TenantKeyError,
    );
    expect(() =>
      assertTenantScopedDynamoOperation(ctx, { operation: 'Query', partition_key: 'TENANT#other' }),
    ).toThrow(TenantKeyError);
    expect(() =>
      assertTenantScopedDynamoOperation(ctx, {
        operation: 'Query',
        partition_key: 'TENANT#tenant_abc123',
      }),
    ).not.toThrow();
    expect(() =>
      assertTenantScopedDynamoOperation(ctx, {
        operation: 'Query',
        partition_key: 'TENANT#tenant_abc123#BOARD',
        key_type: 'GSI',
      }),
    ).not.toThrow();
  });
});
