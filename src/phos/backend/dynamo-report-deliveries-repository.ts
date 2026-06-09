import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { ReportDeliveryStatus, type ReportDeliveryView } from '@/phos/contracts/phos_contracts';
import { assertTenantGsiKey, reportDeliveryStatusGsiPk } from './dynamodb-keys';
import { phosCoreTableName } from './dynamo-cards-repository';
import { fromDynamoAttributeValue } from './dynamodb-attribute-values';
import type {
  PhosReportDeliverySearchRepository,
  ReportDeliverySearchQuery,
} from './report-deliveries-repository';
import type { TenantContext } from './tenant-context';

type DynamoItem = Record<string, AttributeValue>;

export type DynamoReportDeliveryQueryInput = {
  table_name: string;
  index_name: string;
  partition_key: string;
  limit: number;
  cursor?: string;
};

export type DynamoReportDeliveryQueryOutput = {
  items: DynamoItem[];
  next_cursor?: string;
};

export type DynamoReportDeliveriesClient = {
  queryReportDeliveries(
    input: DynamoReportDeliveryQueryInput,
  ): Promise<DynamoReportDeliveryQueryOutput>;
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

function toReportDeliveryView(item: DynamoItem, now: Date): ReportDeliveryView {
  const delivery = objectAttr(item, 'report_delivery') as ReportDeliveryView;
  const sentAt = Date.parse(delivery.sent_at);
  const stale_minutes =
    typeof delivery.stale_minutes === 'number'
      ? delivery.stale_minutes
      : Number.isFinite(sentAt)
        ? Math.max(0, Math.floor((now.getTime() - sentAt) / 60_000))
        : 0;

  return {
    ...delivery,
    stale_minutes,
    server_version: numberAttr(item, 'server_version') ?? delivery.server_version,
  };
}

export function createDynamoReportDeliveriesRepository(
  client: DynamoReportDeliveriesClient,
  options: { now?: () => Date } = {},
): PhosReportDeliverySearchRepository {
  return {
    async searchReportDeliveries(ctx: TenantContext, query: ReportDeliverySearchQuery) {
      const status = query.status ?? ReportDeliveryStatus.WAITING_REPLY;
      const partition_key = reportDeliveryStatusGsiPk(ctx, status);
      assertTenantGsiKey(ctx, partition_key);

      const result = await client.queryReportDeliveries({
        table_name: phosCoreTableName(),
        index_name: 'GSI1',
        partition_key,
        limit: query.limit,
        cursor: query.cursor,
      });
      const now = options.now?.() ?? new Date();
      const items = result.items
        .map((item) => toReportDeliveryView(item, now))
        .filter((item) => item.status === status);

      if (status === ReportDeliveryStatus.WAITING_REPLY) {
        items.sort(
          (a, b) => b.stale_minutes - a.stale_minutes || a.sent_at.localeCompare(b.sent_at),
        );
      }

      return {
        items,
        ...(result.next_cursor ? { next_cursor: result.next_cursor } : {}),
        server_time: now.toISOString(),
      };
    },
  };
}
