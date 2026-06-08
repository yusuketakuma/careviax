import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import type { ClaimCandidateView } from '@/phos/contracts/phos_contracts';
import { toDynamoAttributeValue } from './dynamodb-attribute-values';
import { createDynamoClaimCandidatesClient } from './claim-candidates-lambda';

function candidate(overrides: Partial<ClaimCandidateView> = {}): ClaimCandidateView {
  return {
    candidate_id: 'claim_1',
    card_id: 'card_1',
    patient_name: '患者 山田太郎',
    fee_code: 'M001',
    fee_label: '在宅患者訪問薬剤管理指導料',
    billing_month: '2026-06-01',
    status: 'READY',
    status_label: '算定可',
    missing_evidence_keys: [],
    evidence_requirements: [],
    rule_version_id: 'rv_2026',
    priority_rank: 10,
    source_refs: [],
    created_at: '2026-06-09T00:00:00.000Z',
    updated_at: '2026-06-09T00:00:00.000Z',
    server_version: 1,
    ...overrides,
  };
}

function item(): Record<string, AttributeValue> {
  return {
    claim_candidate: toDynamoAttributeValue(candidate()),
    server_version: { N: '1' },
  };
}

describe('claim-candidates Lambda Dynamo client', () => {
  it('queries claim candidates with bounded tenant GSI input', async () => {
    const send = vi.fn(async (command: QueryCommand) => {
      expect(command).toBeInstanceOf(QueryCommand);
      return { Items: [item()], LastEvaluatedKey: { PK: { S: 'next' } } };
    });
    const client = createDynamoClaimCandidatesClient({ client: { send } });

    await expect(
      client.queryClaimCandidates({
        table_name: 'phos_core',
        index_name: 'GSI1',
        partition_key: 'TENANT#tenant_abc123#CLAIM_CANDIDATE_STATUS#READY',
        limit: 25,
      }),
    ).resolves.toMatchObject({ items: [item()], next_cursor: expect.any(String) });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      TableName: 'phos_core',
      IndexName: 'GSI1',
      KeyConditionExpression: '#pk = :pk',
      Limit: 25,
      ExpressionAttributeValues: {
        ':pk': { S: 'TENANT#tenant_abc123#CLAIM_CANDIDATE_STATUS#READY' },
      },
    });
  });

  it('updates candidate, idempotency, and card unresolved count in one transaction', async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(async (command: GetItemCommand) => {
        expect(command).toBeInstanceOf(GetItemCommand);
        return { Item: item() };
      })
      .mockImplementationOnce(async (command: TransactWriteItemsCommand) => {
        expect(command).toBeInstanceOf(TransactWriteItemsCommand);
        return {};
      });
    const client = createDynamoClaimCandidatesClient({ client: { send } });

    await expect(
      client.excludeClaimCandidate({
        table_name: 'phos_core',
        partition_key: 'TENANT#tenant_abc123',
        sort_key: 'CLAIM_CANDIDATE#claim_1',
        candidate_id: 'claim_1',
        idempotency_sort_key: 'CLAIM_CANDIDATE_IDEMPOTENCY#exclude#claim_1#idem_1',
        request_fingerprint: 'fp_1',
        client_version: 1,
        reason_code: 'NOT_ELIGIBLE',
        updated_at: '2026-06-09T01:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      candidate: { status: 'EXCLUDED', server_version: 2 },
      side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: 'card_1' }],
    });

    const transaction = send.mock.calls[1]?.[0] as TransactWriteItemsCommand | undefined;
    expect(transaction?.input.TransactItems).toHaveLength(3);
    expect(transaction?.input.TransactItems?.[1]).toMatchObject({
      Update: {
        TableName: 'phos_core',
        Key: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'CARD#card_1' },
        },
        UpdateExpression:
          'SET unresolved_claim_candidate_count = if_not_exists(unresolved_claim_candidate_count, :one) - :one, updated_at = :updated_at',
        ConditionExpression:
          'attribute_not_exists(unresolved_claim_candidate_count) OR unresolved_claim_candidate_count > :zero',
      },
    });
    expect(transaction?.input.TransactItems?.[2]).toMatchObject({
      Update: {
        Key: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'CLAIM_CANDIDATE#claim_1' },
        },
        UpdateExpression:
          'SET claim_candidate = :candidate, server_version = :version, updated_at = :updated_at, #gsi1pk = :status_gsi_pk, #gsi1sk = :status_gsi_sk',
        ConditionExpression:
          'server_version = :client_version AND claim_candidate.#status <> :approved AND claim_candidate.#status <> :excluded',
        ExpressionAttributeNames: {
          '#gsi1pk': 'GSI1PK',
          '#gsi1sk': 'GSI1SK',
        },
        ExpressionAttributeValues: {
          ':status_gsi_pk': {
            S: 'TENANT#tenant_abc123#CLAIM_CANDIDATE_STATUS#EXCLUDED',
          },
          ':status_gsi_sk': {
            S: 'MONTH#2026-06-01#PRIORITY#0010#CANDIDATE#claim_1',
          },
        },
      },
    });
  });
});
