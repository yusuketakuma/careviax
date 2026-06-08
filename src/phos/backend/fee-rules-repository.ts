import type { FeeRuleSearchResponse } from '@/phos/contracts/phos_contracts';
import type { TenantContext } from './tenant-context';

export type FeeRuleSearchQuery = {
  fee_code?: string;
  cursor?: string;
  limit: number;
};

export type PhosFeeRulesRepository = {
  searchFeeRules(ctx: TenantContext, query: FeeRuleSearchQuery): Promise<FeeRuleSearchResponse>;
};
