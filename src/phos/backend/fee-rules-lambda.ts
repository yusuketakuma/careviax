import {
  createAuroraFeeRulesRepository,
  type AuroraFeeRulesClient,
} from './aurora-fee-rules-repository';
import { createFeeRuleSearchHandler } from './fee-rules-handlers';
import type { PhosFeeRulesRepository } from './fee-rules-repository';
import {
  createLambdaObservabilitySink,
  type PhosLambdaRuntimeDependencies,
} from './lambda-observability';
import { withTenantContext } from './lambda-handler';

type FeeRulesLambdaDependencies = PhosLambdaRuntimeDependencies & {
  repository?: PhosFeeRulesRepository;
  auroraPool?: AuroraFeeRulesClient;
  databaseUrl?: string;
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

function createLazyFeeRulesRepository(
  deps: FeeRulesLambdaDependencies = {},
): PhosFeeRulesRepository {
  let repository: PhosFeeRulesRepository | undefined;
  return {
    searchFeeRules(ctx, query) {
      repository ??= createFeeRulesRepository(deps);
      return repository.searchFeeRules(ctx, query);
    },
  };
}

export function createFeeRuleSearchLambdaHandler(deps: FeeRulesLambdaDependencies = {}) {
  const repository = deps.repository
    ? createFeeRulesRepository(deps)
    : createLazyFeeRulesRepository(deps);
  return withTenantContext(createFeeRuleSearchHandler(repository), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

let defaultFeeRuleSearchHandler: ReturnType<typeof createFeeRuleSearchLambdaHandler> | undefined;

export const feeRuleSearchHandler: ReturnType<typeof createFeeRuleSearchLambdaHandler> = (
  event,
) => {
  defaultFeeRuleSearchHandler ??= createFeeRuleSearchLambdaHandler();
  return defaultFeeRuleSearchHandler(event);
};
