import { describe, expect, it, vi } from 'vitest';
import { ReportDeliveryStatus, UserRole } from '@/phos/contracts/phos_contracts';
import type { ReportDeliveryMutationResponse } from '@/phos/contracts/phos_contracts';
import {
  createRegisterReportReplyLambdaHandler,
  createDynamoReportDeliveriesClient,
  createReportDeliverySearchLambdaHandler,
} from './report-deliveries-lambda';
import { toDynamoAttributeValue } from './dynamodb-attribute-values';

describe('report-deliveries lambda composition', () => {
  it('exports a composed handler that reaches the injected repository with tenant context', async () => {
    const repository = {
      searchReportDeliveries: vi.fn(async () => ({
        items: [],
        server_time: '2026-06-09T00:00:00.000Z',
      })),
      registerReportReply: vi.fn(),
      markReportActionDone: vi.fn(),
    };
    const handler = createReportDeliverySearchLambdaHandler({ repository });

    const response = await handler({
      routeKey: 'GET /report-deliveries',
      queryStringParameters: { status: ReportDeliveryStatus.WAITING_REPLY },
      requestContext: {
        requestId: 'req_1',
        authorizer: {
          jwt: {
            claims: {
              tenant_id: 'tenant_abc123',
              sub: 'user_1',
              role: UserRole.PHARMACY_CLERK,
              token_use: 'access',
              scope: 'phos/report-deliveries.read',
            },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.searchReportDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant_abc123',
        user_id: 'user_1',
        role: UserRole.PHARMACY_CLERK,
      }),
      { status: ReportDeliveryStatus.WAITING_REPLY, limit: 50 },
    );
  });

  it('exports composed mutation handlers for registering report replies', async () => {
    const repository = {
      searchReportDeliveries: vi.fn(),
      registerReportReply: vi.fn(async (): Promise<ReportDeliveryMutationResponse> => ({
        delivery: {
          delivery_id: 'delivery_1',
          card_id: 'card_1',
          report_id: 'report_1',
          patient_name: '患者 山田太郎',
          target_label: '山田医師',
          sent_at: '2026-06-09T00:00:00.000Z',
          stale_minutes: 0,
          status: ReportDeliveryStatus.ACTION_DONE,
          delivery_method: 'FAX',
          server_version: 2,
          source_refs: [],
        },
        side_effects: [{ type: 'REPORT_ACTION_DONE', delivery_id: 'delivery_1' }],
        server_version: 2,
      })),
      markReportActionDone: vi.fn(),
    };
    const handler = createRegisterReportReplyLambdaHandler({ repository });

    const response = await handler({
      routeKey: 'POST /report-deliveries/{delivery_id}/reply',
      pathParameters: { delivery_id: 'delivery_1' },
      body: JSON.stringify({
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '問題ありません。',
        idempotency_key: 'idem_reply',
        client_version: 1,
      }),
      requestContext: {
        requestId: 'req_1',
        authorizer: {
          jwt: {
            claims: {
              tenant_id: 'tenant_abc123',
              sub: 'user_1',
              role: UserRole.PHARMACY_CLERK,
              token_use: 'access',
              scope: 'phos/report-deliveries.write',
            },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.registerReportReply).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123' }),
      'delivery_1',
      {
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '問題ありません。',
        idempotency_key: 'idem_reply',
        client_version: 1,
      },
    );
  });

  it('builds a DynamoDB QueryCommand against the report-delivery status GSI', async () => {
    const send = vi.fn(async () => ({
      Items: [{ report_delivery: toDynamoAttributeValue({ delivery_id: 'delivery_1' }) }],
      LastEvaluatedKey: { PK: { S: 'TENANT#tenant_abc123' }, SK: { S: 'REPORT_DELIVERY#1' } },
    }));
    const client = createDynamoReportDeliveriesClient({ client: { send } });

    await expect(
      client.queryReportDeliveries({
        table_name: 'phos_core',
        index_name: 'GSI1',
        partition_key: 'TENANT#tenant_abc123#REPORT_DELIVERY_STATUS#WAITING_REPLY',
        limit: 10,
      }),
    ).resolves.toMatchObject({
      items: [{ report_delivery: expect.any(Object) }],
      next_cursor: expect.any(String),
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: 'phos_core',
          IndexName: 'GSI1',
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': 'GSI1PK' },
          ExpressionAttributeValues: {
            ':pk': { S: 'TENANT#tenant_abc123#REPORT_DELIVERY_STATUS#WAITING_REPLY' },
          },
          Limit: 10,
          ScanIndexForward: false,
        }),
      }),
    );
  });
});
