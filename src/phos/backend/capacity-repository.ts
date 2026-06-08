import type { CapacityResponse, CapacityScope } from '@/phos/contracts/phos_contracts';
import type { TenantContext } from './tenant-context';

export type CapacityQuery = {
  date: string;
  scope: CapacityScope;
};

export type PhosCapacityRepository = {
  getCapacity(ctx: TenantContext, query: CapacityQuery): Promise<CapacityResponse>;
};
