import type { TenantContext } from './tenant-context';

export type TenantScopedQuery = {
  operation: 'Query';
  partition_key: string;
  key_type?: 'PK' | 'GSI';
};

export type ForbiddenScan = {
  operation: 'Scan';
};

export class TenantKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantKeyError';
  }
}

export function tenantPk(ctx: Pick<TenantContext, 'tenant_id'>): string {
  return `TENANT#${ctx.tenant_id}`;
}

export function cardSk(card_id: string): string {
  return `CARD#${card_id}`;
}

export function cardEventSk(input: {
  card_id: string;
  created_at: string;
  event_id: string;
}): string {
  return `CARD_EVENT#${input.card_id}#${input.created_at}#${input.event_id}`;
}

export function cardBlockerSk(input: { card_id: string; blocker_code: string }): string {
  return `CARD_BLOCKER#${input.card_id}#${input.blocker_code}`;
}

export function cardActionIdempotencySk(input: {
  card_id: string;
  idempotency_key: string;
}): string {
  return `CARD_ACTION_IDEMPOTENCY#${input.card_id}#${input.idempotency_key}`;
}

export function visitPacketSk(packet_id: string): string {
  return `VISIT_PACKET#${packet_id}`;
}

export function packetCardSk(input: { packet_id: string; card_id: string }): string {
  return `PACKET_CARD#${input.packet_id}#${input.card_id}`;
}

export function visitStepIdempotencySk(input: {
  packet_id: string;
  step: string;
  idempotency_key: string;
}): string {
  return `VISIT_STEP_IDEMPOTENCY#${input.packet_id}#${input.step}#${input.idempotency_key}`;
}

export function evidenceSk(evidence_id: string): string {
  return `EVIDENCE#${evidence_id}`;
}

export function reportDeliverySk(delivery_id: string): string {
  return `REPORT_DELIVERY#${delivery_id}`;
}

export function reportDeliveryIdempotencySk(input: {
  mutation_key: string;
  idempotency_key: string;
}): string {
  return `REPORT_DELIVERY_IDEMPOTENCY#${input.mutation_key}#${input.idempotency_key}`;
}

export function reportDeliveryStatusGsiPk(
  ctx: Pick<TenantContext, 'tenant_id'>,
  status: string,
): string {
  return `${tenantPk(ctx)}#REPORT_DELIVERY_STATUS#${status}`;
}

export function reportDeliveryStatusGsiSk(input: {
  stale_minutes: number;
  sent_at: string;
  delivery_id: string;
}): string {
  const staleRank = String(Math.max(0, input.stale_minutes)).padStart(8, '0');
  return `STALE#${staleRank}#SENT#${input.sent_at}#DELIVERY#${input.delivery_id}`;
}

export function claimCandidateSk(candidate_id: string): string {
  return `CLAIM_CANDIDATE#${candidate_id}`;
}

export function claimCandidateIdempotencySk(input: {
  mutation_key: string;
  idempotency_key: string;
}): string {
  return `CLAIM_CANDIDATE_IDEMPOTENCY#${input.mutation_key}#${input.idempotency_key}`;
}

export function claimCandidateStatusGsiPk(
  ctx: Pick<TenantContext, 'tenant_id'>,
  status: string,
): string {
  return `${tenantPk(ctx)}#CLAIM_CANDIDATE_STATUS#${status}`;
}

export function claimCandidateStatusGsiSk(input: {
  billing_month: string;
  priority_rank: number;
  candidate_id: string;
}): string {
  const priority = String(Math.max(0, input.priority_rank)).padStart(4, '0');
  return `MONTH#${input.billing_month}#PRIORITY#${priority}#CANDIDATE#${input.candidate_id}`;
}

export function claimCandidateCardGsiPk(
  ctx: Pick<TenantContext, 'tenant_id'>,
  card_id: string,
): string {
  return `${tenantPk(ctx)}#CLAIM_CANDIDATE_CARD#${card_id}`;
}

export function capacitySk(input: { date: string; scope: string }): string {
  return `CAPACITY#${input.date}#${input.scope}`;
}

export function handoffSk(handoff_id: string): string {
  return `HANDOFF#${handoff_id}`;
}

export function handoffIdempotencySk(input: {
  mutation_key: string;
  idempotency_key: string;
}): string {
  return `HANDOFF_IDEMPOTENCY#${input.mutation_key}#${input.idempotency_key}`;
}

export function handoffAssigneeGsiPk(
  ctx: Pick<TenantContext, 'tenant_id'>,
  assignee_user_id: string,
): string {
  return `${tenantPk(ctx)}#HANDOFF_ASSIGNEE#${assignee_user_id}`;
}

export function handoffAssigneeGsiSk(input: {
  status: string;
  urgency_rank: number;
  created_at: string;
  handoff_id: string;
}): string {
  return `STATUS#${input.status}#URGENCY#${input.urgency_rank}#CREATED#${input.created_at}#HANDOFF#${input.handoff_id}`;
}

export function userSk(user_id: string): string {
  return `USER#${user_id}`;
}

export function boardGsiPk(ctx: Pick<TenantContext, 'tenant_id'>): string {
  return `${tenantPk(ctx)}#BOARD`;
}

export function boardGsiSk(input: {
  current_step: string;
  due_at: string;
  card_id: string;
}): string {
  return `STEP#${input.current_step}#DUE#${input.due_at}#CARD#${input.card_id}`;
}

export function assigneeGsiPk(ctx: Pick<TenantContext, 'tenant_id'>, user_id: string): string {
  return `${tenantPk(ctx)}#ASSIGNEE#${user_id}`;
}

export function assigneeStatusDueGsiSk(input: {
  display_status: string;
  due_at: string;
  card_id: string;
}): string {
  return `STATUS#${input.display_status}#DUE#${input.due_at}#CARD#${input.card_id}`;
}

export function patientGsiPk(ctx: Pick<TenantContext, 'tenant_id'>, patient_id: string): string {
  return `${tenantPk(ctx)}#PATIENT#${patient_id}`;
}

export function patientTimelineGsiSk(input: { created_at: string; card_id: string }): string {
  return `CREATED#${input.created_at}#CARD#${input.card_id}`;
}

export function packetGsiPk(ctx: Pick<TenantContext, 'tenant_id'>, packet_id: string): string {
  return `${tenantPk(ctx)}#PACKET#${packet_id}`;
}

export function packetGsiSk(card_id: string): string {
  return `CARD#${card_id}`;
}

export function assertTenantPk(ctx: Pick<TenantContext, 'tenant_id'>, pk: string): void {
  if (pk !== tenantPk(ctx)) {
    throw new TenantKeyError(`DynamoDB key is not scoped to tenant ${ctx.tenant_id}`);
  }
}

export function assertTenantGsiKey(ctx: Pick<TenantContext, 'tenant_id'>, gsiPk: string): void {
  if (!gsiPk.startsWith(`${tenantPk(ctx)}#`)) {
    throw new TenantKeyError(`DynamoDB GSI key is not scoped to tenant ${ctx.tenant_id}`);
  }
}

export function assertTenantScopedDynamoOperation(
  ctx: Pick<TenantContext, 'tenant_id'>,
  op: TenantScopedQuery | ForbiddenScan,
) {
  if (op.operation === 'Scan') {
    throw new TenantKeyError('DynamoDB Scan is forbidden for PH-OS tenant-scoped repositories');
  }
  if (op.key_type === 'GSI') {
    assertTenantGsiKey(ctx, op.partition_key);
    return;
  }
  assertTenantPk(ctx, op.partition_key);
}
