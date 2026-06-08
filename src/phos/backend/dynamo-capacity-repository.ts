import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type {
  CapacityBottleneck,
  CapacityStaffLoad,
  CapacityWorkBucket,
} from '@/phos/contracts/phos_contracts';
import { resolveCapacity } from '@/phos/domain/capacity/capacityEngine';
import type { CapacityQuery, PhosCapacityRepository } from './capacity-repository';
import { capacitySk, tenantPk, assertTenantPk } from './dynamodb-keys';
import type { DynamoGetInput } from './dynamo-cards-repository';
import { PHOS_CORE_TABLE } from './dynamo-cards-repository';
import { fromDynamoAttributeValue } from './dynamodb-attribute-values';
import type { TenantContext } from './tenant-context';

type DynamoItem = Record<string, AttributeValue>;

export type DynamoCapacityClient = {
  getCapacitySnapshot(input: DynamoGetInput): Promise<DynamoItem | null>;
};

function readArray<T>(item: DynamoItem, key: string): T[] {
  const value = item[key];
  if (!value) return [];
  const parsed = fromDynamoAttributeValue(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function createDynamoCapacityRepository(
  client: DynamoCapacityClient,
  options: { now?: () => Date } = {},
): PhosCapacityRepository {
  return {
    async getCapacity(ctx: TenantContext, query: CapacityQuery) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      const item = await client.getCapacitySnapshot({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: capacitySk({ date: query.date, scope: query.scope }),
      });
      const server_time = (options.now?.() ?? new Date()).toISOString();

      return resolveCapacity({
        date: query.date,
        scope: query.scope,
        work_buckets: item ? readArray<CapacityWorkBucket>(item, 'work_buckets') : [],
        staff_loads: item ? readArray<CapacityStaffLoad>(item, 'staff_loads') : [],
        bottlenecks: item ? readArray<CapacityBottleneck>(item, 'bottlenecks') : [],
        server_time,
      });
    },
  };
}
