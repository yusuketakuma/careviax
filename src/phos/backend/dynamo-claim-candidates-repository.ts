import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type {
  ClaimCandidateMutationResponse,
  ClaimCandidateStatus,
  ClaimCandidateView,
  ExcludeClaimCandidateRequest,
} from '@/phos/contracts/phos_contracts';
import {
  assertTenantGsiKey,
  claimCandidateCardGsiPk,
  claimCandidateIdempotencySk,
  claimCandidateSk,
  claimCandidateStatusGsiPk,
  tenantPk,
} from './dynamodb-keys';
import { PHOS_CORE_TABLE } from './dynamo-cards-repository';
import { fromDynamoAttributeValue } from './dynamodb-attribute-values';
import type {
  ClaimCandidateSearchQuery,
  PhosClaimCandidatesRepository,
} from './claim-candidates-repository';
import { PhosDomainError } from './cards-repository';
import type { DynamoGetInput } from './dynamo-cards-repository';
import type { TenantContext } from './tenant-context';

type DynamoItem = Record<string, AttributeValue>;

export type DynamoClaimCandidateQueryInput = {
  table_name: string;
  index_name: string;
  partition_key: string;
  limit: number;
  cursor?: string;
};

export type DynamoClaimCandidateQueryOutput = {
  items: DynamoItem[];
  next_cursor?: string;
};

export type DynamoClaimCandidateExcludeInput = {
  table_name: string;
  partition_key: string;
  sort_key: string;
  candidate_id: string;
  idempotency_sort_key: string;
  request_fingerprint: string;
  client_version: number;
  reason_code: string;
  reason_note?: string;
  updated_at: string;
};

export type DynamoClaimCandidatesClient = {
  getIdempotency(input: DynamoGetInput): Promise<DynamoItem | null>;
  queryClaimCandidates(
    input: DynamoClaimCandidateQueryInput,
  ): Promise<DynamoClaimCandidateQueryOutput>;
  excludeClaimCandidate(
    input: DynamoClaimCandidateExcludeInput,
  ): Promise<ClaimCandidateMutationResponse>;
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

function numberAttr(item: DynamoItem, key: string): number | undefined {
  const value = item[key];
  if (!value) return undefined;
  const parsed = fromDynamoAttributeValue(value);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

function stringAttr(item: DynamoItem, key: string): string | undefined {
  const value = item[key];
  if (!value) return undefined;
  const parsed = fromDynamoAttributeValue(value);
  return typeof parsed === 'string' ? parsed : undefined;
}

function parseJsonAttr<T>(item: DynamoItem, key: string): T | undefined {
  const value = stringAttr(item, key);
  return value ? (JSON.parse(value) as T) : undefined;
}

function toClaimCandidateView(item: DynamoItem): ClaimCandidateView {
  const candidate = objectAttr(item, 'claim_candidate') as ClaimCandidateView;
  return {
    ...candidate,
    server_version: numberAttr(item, 'server_version') ?? candidate.server_version,
  };
}

function requestFingerprint(command: ExcludeClaimCandidateRequest): string {
  return JSON.stringify({
    client_version: command.client_version,
    reason_code: command.reason_code,
    reason_note: command.reason_note ?? null,
  });
}

function idempotencyConflict(idempotency_key: string): PhosDomainError {
  return new PhosDomainError({
    status: 409,
    error_code: 'IDEMPOTENCY_CONFLICT',
    message_key: 'api.error.idempotency_conflict',
    details: { idempotency_key },
  });
}

export function createDynamoClaimCandidatesRepository(
  client: DynamoClaimCandidatesClient,
  options: { now?: () => Date } = {},
): PhosClaimCandidatesRepository {
  return {
    async searchClaimCandidates(ctx: TenantContext, query: ClaimCandidateSearchQuery) {
      const status: ClaimCandidateStatus = query.status ?? 'MISSING_EVIDENCE';
      const partition_key = query.card_id
        ? claimCandidateCardGsiPk(ctx, query.card_id)
        : claimCandidateStatusGsiPk(ctx, status);
      assertTenantGsiKey(ctx, partition_key);

      const result = await client.queryClaimCandidates({
        table_name: PHOS_CORE_TABLE,
        index_name: query.card_id ? 'GSI2' : 'GSI1',
        partition_key,
        limit: query.limit,
        cursor: query.cursor,
      });
      const items = result.items
        .map(toClaimCandidateView)
        .filter((item) =>
          query.card_id ? item.card_id === query.card_id : item.status === status,
        );

      return {
        items,
        ...(result.next_cursor ? { next_cursor: result.next_cursor } : {}),
        server_time: (options.now?.() ?? new Date()).toISOString(),
      };
    },
    async excludeClaimCandidate(ctx, candidate_id, command) {
      const partition_key = tenantPk(ctx);
      const request_fingerprint = requestFingerprint(command);
      const idempotency_sort_key = claimCandidateIdempotencySk({
        mutation_key: `exclude#${candidate_id}`,
        idempotency_key: command.idempotency_key,
      });
      const idempotencyItem = await client.getIdempotency({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: idempotency_sort_key,
      });
      if (idempotencyItem) {
        const existingFingerprint = stringAttr(idempotencyItem, 'request_fingerprint');
        const response = parseJsonAttr<ClaimCandidateMutationResponse>(
          idempotencyItem,
          'response_json',
        );
        if (existingFingerprint === request_fingerprint && response) return response;
        throw idempotencyConflict(command.idempotency_key);
      }

      return client.excludeClaimCandidate({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: claimCandidateSk(candidate_id),
        candidate_id,
        idempotency_sort_key,
        request_fingerprint,
        client_version: command.client_version,
        reason_code: command.reason_code,
        ...(command.reason_note ? { reason_note: command.reason_note } : {}),
        updated_at: (options.now?.() ?? new Date()).toISOString(),
      });
    },
  };
}
