import { TransactWriteItemsCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { VisitStatus, VisitStep, type VisitModeView } from '@/phos/contracts/phos_contracts';
import { createDynamoVisitModeClient } from './visit-mode-lambda';

function visit(overrides: Partial<VisitModeView> = {}): VisitModeView {
  return {
    packet_id: 'packet_1',
    card_id: 'card_1',
    server_version: 4,
    patient_name: 'patient',
    visit_status: VisitStatus.IN_PROGRESS,
    applicable_steps: [VisitStep.EVIDENCE_UPLOAD],
    required_steps: [VisitStep.EVIDENCE_UPLOAD],
    step_completed: {
      ARRIVAL_CONFIRM: false,
      TODAY_BRIEF_ACK: false,
      DELIVERY_AND_SET: false,
      RESIDUAL_CHECK: false,
      ADHERENCE_ADR_CHECK: false,
      EXPLANATION: false,
      NEXT_SCHEDULE: false,
      EVIDENCE_UPLOAD: true,
      REPORT_SEED: false,
      COMPLETE_CHECK: false,
    },
    last_opened_step: VisitStep.EVIDENCE_UPLOAD,
    evidence_sync: { blocking_unsynced_count: 0, non_blocking_unsynced_count: 0 },
    online: true,
    ...overrides,
  };
}

describe('PH-OS visit-mode Lambda Dynamo client', () => {
  it('updates verified evidence and visit packet in one transaction', async () => {
    const send = vi.fn(async (command: TransactWriteItemsCommand) => {
      expect(command).toBeInstanceOf(TransactWriteItemsCommand);
      return {};
    });
    const client = createDynamoVisitModeClient({ client: { send } });
    const response = visit();

    await client.transactCommitVisitStep({
      table_name: 'phos_core',
      partition_key: 'TENANT#tenant_abc123',
      visit_packet_sort_key: 'VISIT_PACKET#packet_1',
      idempotency_sort_key: 'VISIT_STEP_IDEMPOTENCY#packet_1#EVIDENCE_UPLOAD#idem_1',
      evidence_sort_key: 'EVIDENCE#evidence_1',
      expected_server_version: 3,
      actor_user_id: 'user_1',
      request_fingerprint: 'fingerprint_1',
      response,
      verified_evidence: {
        evidence_id: 'evidence_1',
        card_id: 'card_1',
        s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
        s3_version_id: '3HL4kqtJlcpXroDTDmjVBH40Nrjfkd',
      },
      committed_at: '2026-06-09T00:00:00.000Z',
    });

    const command = send.mock.calls[0]?.[0] as TransactWriteItemsCommand;
    expect(command.input.TransactItems?.[0]).toMatchObject({
      Update: {
        TableName: 'phos_core',
        Key: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'EVIDENCE#evidence_1' },
        },
        UpdateExpression:
          'SET upload_status = :verified, packet_id = :packet_id, visit_step = :visit_step, verified_at = :updated_at, updated_at = :updated_at, s3_verified_tag_status = :tag_pending, s3_verified_tag_attempted_at = :updated_at, s3_version_id = :s3_version_id REMOVE ttl_epoch_seconds, s3_verified_tag_error',
        ConditionExpression:
          'card_id = :card_id AND s3_key = :s3_key AND upload_status = :presigned AND expires_at > :updated_at',
        ExpressionAttributeValues: {
          ':verified': { S: 'VERIFIED' },
          ':presigned': { S: 'PRESIGNED' },
          ':tag_pending': { S: 'PENDING' },
          ':card_id': { S: 'card_1' },
          ':s3_key': { S: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg' },
          ':s3_version_id': { S: '3HL4kqtJlcpXroDTDmjVBH40Nrjfkd' },
        },
      },
    });
    expect(command.input.TransactItems).toHaveLength(3);
    expect(command.input.TransactItems?.[2]).toMatchObject({
      Put: {
        Item: {
          SK: { S: 'VISIT_STEP_IDEMPOTENCY#packet_1#EVIDENCE_UPLOAD#idem_1' },
          actor_user_id: { S: 'user_1' },
          request_fingerprint: { S: 'fingerprint_1' },
        },
        ConditionExpression:
          'attribute_not_exists(PK) OR (request_fingerprint = :request_fingerprint AND actor_user_id = :actor_user_id)',
        ExpressionAttributeValues: {
          ':actor_user_id': { S: 'user_1' },
          ':request_fingerprint': { S: 'fingerprint_1' },
        },
      },
    });
  });

  it('marks evidence object tag status as TAGGED after S3 tagging succeeds', async () => {
    const send = vi.fn(async (command: UpdateItemCommand) => {
      expect(command).toBeInstanceOf(UpdateItemCommand);
      return {};
    });
    const client = createDynamoVisitModeClient({ client: { send } });

    await client.markEvidenceObjectTagCommitted?.({
      table_name: 'phos_core',
      partition_key: 'TENANT#tenant_abc123',
      evidence_sort_key: 'EVIDENCE#evidence_1',
      evidence: {
        evidence_id: 'evidence_1',
        card_id: 'card_1',
        s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
        s3_version_id: '3HL4kqtJlcpXroDTDmjVBH40Nrjfkd',
      },
      tagged_at: '2026-06-09T00:00:01.000Z',
    });

    const command = send.mock.calls[0]?.[0] as UpdateItemCommand;
    expect(command.input).toMatchObject({
      TableName: 'phos_core',
      Key: {
        PK: { S: 'TENANT#tenant_abc123' },
        SK: { S: 'EVIDENCE#evidence_1' },
      },
      UpdateExpression:
        'SET s3_verified_tag_status = :tagged, s3_verified_tagged_at = :tagged_at, updated_at = :tagged_at REMOVE s3_verified_tag_error',
      ConditionExpression:
        'upload_status = :verified AND s3_key = :s3_key AND (attribute_not_exists(s3_version_id) OR s3_version_id = :s3_version_id)',
      ExpressionAttributeValues: {
        ':tagged': { S: 'TAGGED' },
        ':tagged_at': { S: '2026-06-09T00:00:01.000Z' },
        ':verified': { S: 'VERIFIED' },
        ':s3_key': { S: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg' },
        ':s3_version_id': { S: '3HL4kqtJlcpXroDTDmjVBH40Nrjfkd' },
      },
    });
  });
});
