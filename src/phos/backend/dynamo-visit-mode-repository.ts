import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { VisitModeView } from '@/phos/contracts/phos_contracts';
import {
  assertTenantPk,
  evidenceSk,
  tenantPk,
  visitPacketSk,
  visitStepIdempotencySk,
} from './dynamodb-keys';
import type { DynamoGetInput } from './dynamo-cards-repository';
import { phosCoreTableName } from './dynamo-cards-repository';
import { fromDynamoAttributeValue } from './dynamodb-attribute-values';
import type {
  EvidenceUploadVerificationInput,
  IdempotentVisitStepLookup,
  VerifiedEvidenceUpload,
  VisitModeLifecycleStore,
  VisitStepCommitInput,
} from './visit-mode-lifecycle-repository';
import type { TenantContext } from './tenant-context';
import { PhosDomainError } from './cards-repository';
import { assertTenantS3Key, TenantStorageKeyError } from './s3-evidence-key';
import {
  EvidenceObjectVerificationError,
  type EvidenceObjectVerifier,
} from './evidence-upload-verification';

type DynamoItem = Record<string, AttributeValue>;

export type DynamoVisitStepCommitTransaction = {
  table_name: string;
  partition_key: string;
  visit_packet_sort_key: string;
  idempotency_sort_key: string;
  evidence_sort_key?: string;
  expected_server_version: number;
  request_fingerprint: string;
  response: VisitModeView;
  verified_evidence?: VerifiedEvidenceUpload;
  committed_at: string;
};

export type DynamoVisitModeClient = {
  getVisitPacket(input: DynamoGetInput): Promise<DynamoItem | null>;
  getIdempotency(input: DynamoGetInput): Promise<DynamoItem | null>;
  getEvidenceIntent(input: DynamoGetInput): Promise<DynamoItem | null>;
  transactCommitVisitStep(input: DynamoVisitStepCommitTransaction): Promise<void>;
};

function objectAttr(item: DynamoItem, key: string): Record<string, unknown> {
  const value = item[key];
  if (!value) throw new Error(`Missing DynamoDB map attribute: ${key}`);
  const parsed = fromDynamoAttributeValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`DynamoDB attribute is not an object: ${key}`);
  }
  return parsed as Record<string, unknown>;
}

function stringAttr(item: DynamoItem, key: string): string | undefined {
  const value = item[key];
  if (!value) return undefined;
  const parsed = fromDynamoAttributeValue(value);
  return typeof parsed === 'string' ? parsed : undefined;
}

function numberAttr(item: DynamoItem, key: string): number | undefined {
  const value = item[key];
  if (!value) return undefined;
  const parsed = fromDynamoAttributeValue(value);
  return typeof parsed === 'number' ? parsed : undefined;
}

function parseJsonAttr<T>(item: DynamoItem, key: string): T | undefined {
  const value = stringAttr(item, key);
  return value ? (JSON.parse(value) as T) : undefined;
}

function evidenceGuardFailed(details: Record<string, unknown>): PhosDomainError {
  return new PhosDomainError({
    status: 422,
    error_code: 'ACTION_GUARD_FAILED',
    message_key: 'api.error.visit_mode_guard_failed',
    details,
  });
}

function assertEvidenceIdShape(evidence_id: string): void {
  if (
    evidence_id.trim().length === 0 ||
    evidence_id.includes('/') ||
    evidence_id.includes('\\') ||
    evidence_id.includes('..')
  ) {
    throw evidenceGuardFailed({
      step: 'EVIDENCE_UPLOAD',
      reason: 'invalid_evidence_id',
    });
  }
}

function parseEvidenceIntent(item: DynamoItem | null, evidence_id: string) {
  if (!item) {
    throw evidenceGuardFailed({
      step: 'EVIDENCE_UPLOAD',
      evidence_id,
      reason: 'evidence_intent_not_found',
    });
  }
  const intent = {
    evidence_id: stringAttr(item, 'evidence_id'),
    card_id: stringAttr(item, 'card_id'),
    s3_key: stringAttr(item, 's3_key'),
    mime_type: stringAttr(item, 'mime_type'),
    sha256: stringAttr(item, 'sha256'),
    size_bytes: numberAttr(item, 'size_bytes'),
    expires_at: stringAttr(item, 'expires_at'),
    upload_status: stringAttr(item, 'upload_status'),
  };
  const size_bytes = intent.size_bytes;
  if (
    intent.evidence_id !== evidence_id ||
    !intent.card_id ||
    !intent.s3_key ||
    !intent.mime_type ||
    !intent.sha256 ||
    !intent.expires_at ||
    typeof size_bytes !== 'number' ||
    !Number.isSafeInteger(size_bytes) ||
    intent.upload_status !== 'PRESIGNED'
  ) {
    throw evidenceGuardFailed({
      step: 'EVIDENCE_UPLOAD',
      evidence_id,
      reason: 'invalid_evidence_intent',
      upload_status: intent.upload_status ?? null,
    });
  }
  return {
    evidence_id,
    card_id: intent.card_id,
    s3_key: intent.s3_key,
    mime_type: intent.mime_type,
    sha256: intent.sha256,
    size_bytes,
    expires_at: intent.expires_at,
  };
}

function parseEvidenceObjectTagTarget(item: DynamoItem | null, evidence_id: string) {
  if (!item) {
    throw evidenceGuardFailed({
      step: 'EVIDENCE_UPLOAD',
      evidence_id,
      reason: 'evidence_intent_not_found',
    });
  }
  const evidence = {
    evidence_id: stringAttr(item, 'evidence_id'),
    card_id: stringAttr(item, 'card_id'),
    s3_key: stringAttr(item, 's3_key'),
    upload_status: stringAttr(item, 'upload_status'),
  };
  if (
    evidence.evidence_id !== evidence_id ||
    !evidence.card_id ||
    !evidence.s3_key ||
    (evidence.upload_status !== 'PRESIGNED' && evidence.upload_status !== 'VERIFIED')
  ) {
    throw evidenceGuardFailed({
      step: 'EVIDENCE_UPLOAD',
      evidence_id,
      reason: 'invalid_evidence_intent',
      upload_status: evidence.upload_status ?? null,
    });
  }
  return {
    evidence_id,
    card_id: evidence.card_id,
    s3_key: evidence.s3_key,
  };
}

async function verifyEvidenceUploadIntent(input: {
  ctx: TenantContext;
  verifier?: EvidenceObjectVerifier;
  verification: EvidenceUploadVerificationInput;
  item: DynamoItem | null;
  now: Date;
}): Promise<VerifiedEvidenceUpload> {
  const evidence_id = input.verification.evidence_key.trim();
  assertEvidenceIdShape(evidence_id);
  if (!input.verification.visit.card_id) {
    throw evidenceGuardFailed({
      packet_id: input.verification.packet_id,
      step: input.verification.step,
      reason: 'missing_visit_card_id',
    });
  }
  const intent = parseEvidenceIntent(input.item, evidence_id);
  if (intent.card_id !== input.verification.visit.card_id) {
    throw evidenceGuardFailed({
      packet_id: input.verification.packet_id,
      step: input.verification.step,
      evidence_id,
      reason: 'evidence_card_mismatch',
    });
  }
  const size_bytes = intent.size_bytes;
  const expiresAtMs = Date.parse(intent.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= input.now.getTime()) {
    throw evidenceGuardFailed({
      packet_id: input.verification.packet_id,
      step: input.verification.step,
      evidence_id,
      reason: 'evidence_upload_intent_expired',
    });
  }
  try {
    assertTenantS3Key(input.ctx, intent.s3_key);
  } catch (error) {
    if (error instanceof TenantStorageKeyError) {
      throw evidenceGuardFailed({
        packet_id: input.verification.packet_id,
        step: input.verification.step,
        evidence_id,
        reason: 'evidence_tenant_mismatch',
      });
    }
    throw error;
  }
  if (!input.verifier) {
    throw evidenceGuardFailed({
      packet_id: input.verification.packet_id,
      step: input.verification.step,
      evidence_id,
      reason: 'evidence_object_verifier_unavailable',
    });
  }
  try {
    await input.verifier.verifyObject({
      key: intent.s3_key,
      mime_type: intent.mime_type,
      sha256: intent.sha256,
      size_bytes,
      allowed_key_prefix: `tenants/${input.ctx.tenant_id}/evidence/`,
      tenant_id: input.ctx.tenant_id,
      user_id: input.ctx.user_id,
      request_id: input.ctx.request_id,
      correlation_id: input.ctx.correlation_id,
    });
  } catch (error) {
    if (error instanceof EvidenceObjectVerificationError) {
      throw evidenceGuardFailed({
        packet_id: input.verification.packet_id,
        step: input.verification.step,
        evidence_id,
        reason: error.reason,
      });
    }
    throw error;
  }
  return {
    evidence_id: intent.evidence_id,
    card_id: intent.card_id,
    s3_key: intent.s3_key,
  };
}

async function markVerifiedEvidenceObject(input: {
  ctx: TenantContext;
  verifier?: EvidenceObjectVerifier;
  evidence: VerifiedEvidenceUpload;
}): Promise<void> {
  if (!input.verifier?.markObjectVerified) {
    throw evidenceGuardFailed({
      step: 'EVIDENCE_UPLOAD',
      evidence_id: input.evidence.evidence_id,
      reason: 'evidence_object_tagger_unavailable',
    });
  }
  try {
    assertTenantS3Key(input.ctx, input.evidence.s3_key);
  } catch (error) {
    if (error instanceof TenantStorageKeyError) {
      throw evidenceGuardFailed({
        step: 'EVIDENCE_UPLOAD',
        evidence_id: input.evidence.evidence_id,
        reason: 'evidence_tenant_mismatch',
      });
    }
    throw error;
  }
  await input.verifier.markObjectVerified({
    key: input.evidence.s3_key,
    allowed_key_prefix: `tenants/${input.ctx.tenant_id}/evidence/`,
  });
}

function toVisitModeView(item: DynamoItem): VisitModeView {
  return objectAttr(item, 'visit_mode') as VisitModeView;
}

function toIdempotentLookup(
  item: DynamoItem | null,
  request_fingerprint: string,
): IdempotentVisitStepLookup {
  if (!item) return { status: 'MISS' };
  const existing = stringAttr(item, 'request_fingerprint');
  if (existing !== request_fingerprint) {
    return { status: 'CONFLICT', existing_request_fingerprint: existing ?? '' };
  }
  const response = parseJsonAttr<VisitModeView>(item, 'response');
  if (!response) return { status: 'CONFLICT', existing_request_fingerprint: existing ?? '' };
  return { status: 'MATCH', response };
}

export function createDynamoVisitModeRepository(
  client: DynamoVisitModeClient,
  options: { now?: () => Date; evidence_object_verifier?: EvidenceObjectVerifier } = {},
): VisitModeLifecycleStore {
  return {
    async getIdempotentVisitStep(ctx, mutation_key, idempotency_key, request_fingerprint) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      const [scope, packet_id, step] = mutation_key.split(':');
      if (scope !== 'VISIT_STEP' || !packet_id || !step) {
        throw new Error(`Invalid visit mutation key: ${mutation_key}`);
      }
      const item = await client.getIdempotency({
        table_name: phosCoreTableName(),
        partition_key,
        sort_key: visitStepIdempotencySk({ packet_id, step, idempotency_key }),
      });
      return toIdempotentLookup(item, request_fingerprint);
    },

    async loadVisitMode(ctx, packet_id) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      const item = await client.getVisitPacket({
        table_name: phosCoreTableName(),
        partition_key,
        sort_key: visitPacketSk(packet_id),
      });
      return item ? toVisitModeView(item) : null;
    },

    async verifyEvidenceUpload(ctx, verification) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      const evidence_id = verification.evidence_key.trim();
      assertEvidenceIdShape(evidence_id);
      const item = await client.getEvidenceIntent({
        table_name: phosCoreTableName(),
        partition_key,
        sort_key: evidenceSk(evidence_id),
      });
      return verifyEvidenceUploadIntent({
        ctx,
        verifier: options.evidence_object_verifier,
        verification,
        item,
        now: options.now?.() ?? new Date(),
      });
    },

    async commitVisitStep(ctx: TenantContext, input: VisitStepCommitInput) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      await client.transactCommitVisitStep({
        table_name: phosCoreTableName(),
        partition_key,
        visit_packet_sort_key: visitPacketSk(input.packet_id),
        idempotency_sort_key: visitStepIdempotencySk({
          packet_id: input.packet_id,
          step: input.step,
          idempotency_key: input.command.idempotency_key,
        }),
        ...(input.verified_evidence
          ? {
              evidence_sort_key: evidenceSk(input.verified_evidence.evidence_id),
              verified_evidence: input.verified_evidence,
            }
          : {}),
        expected_server_version: input.previous_visit.server_version,
        request_fingerprint: input.request_fingerprint,
        response: input.response,
        committed_at: (options.now?.() ?? new Date()).toISOString(),
      });
      if (input.verified_evidence) {
        await markVerifiedEvidenceObject({
          ctx,
          verifier: options.evidence_object_verifier,
          evidence: input.verified_evidence,
        });
      }
      return input.response;
    },

    async markVerifiedEvidenceUpload(ctx: TenantContext, evidence_key: string) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      const evidence_id = evidence_key.trim();
      assertEvidenceIdShape(evidence_id);
      const item = await client.getEvidenceIntent({
        table_name: phosCoreTableName(),
        partition_key,
        sort_key: evidenceSk(evidence_id),
      });
      const intent = parseEvidenceObjectTagTarget(item, evidence_id);
      await markVerifiedEvidenceObject({
        ctx,
        verifier: options.evidence_object_verifier,
        evidence: intent,
      });
    },
  };
}
