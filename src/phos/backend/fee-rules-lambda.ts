import {
  createAuroraFeeRulesRepository,
  type AuroraFeeRulesClient,
} from './aurora-fee-rules-repository';
import { createFeeRuleSearchHandler } from './fee-rules-handlers';
import type { PhosFeeRulesRepository } from './fee-rules-repository';
import { withTenantContext } from './lambda-handler';

type FeeRulesLambdaDependencies = {
  repository?: PhosFeeRulesRepository;
  auroraPool?: AuroraFeeRulesClient;
  databaseUrl?: string;
  now?: () => Date;
};

export function createFeeRulesRepository(
  deps: FeeRulesLambdaDependencies = {},
): PhosFeeRulesRepository {
  if (deps.repository) return deps.repository;
  return createAuroraFeeRulesRepository({
    pool: deps.auroraPool,
    databaseUrl:
      deps.databaseUrl ?? process.env.PHOS_AURORA_DATABASE_URL ?? process.env.DATABASE_URL,
    now: deps.now,
  });
}

export function createFeeRuleSearchLambdaHandler(deps: FeeRulesLambdaDependencies = {}) {
  return withTenantContext(createFeeRuleSearchHandler(createFeeRulesRepository(deps)));
}

export const feeRuleSearchHandler: ReturnType<typeof createFeeRuleSearchLambdaHandler> = (event) =>
  createFeeRuleSearchLambdaHandler()(event);
