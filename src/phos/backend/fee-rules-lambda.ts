import {
  GetSecretValueCommand,
  SecretsManagerClient,
  type SecretsManagerClient as AwsSecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
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
import { phosAwsClientConfig, withPhosAwsClientTimeout } from './aws-client-timeout';

type FeeRulesLambdaDependencies = PhosLambdaRuntimeDependencies & {
  repository?: PhosFeeRulesRepository;
  auroraPool?: AuroraFeeRulesClient;
  databaseUrl?: string;
  databaseSecretArn?: string;
  secretsClient?: Pick<AwsSecretsManagerClient, 'send'>;
  repositoryFromDatabaseUrl?: (databaseUrl: string) => PhosFeeRulesRepository;
};

function parseDatabaseUrlSecret(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error('PH-OS FeeRule Aurora database secret is empty');
  if (!trimmed.startsWith('{')) return trimmed;

  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  const value =
    parsed.databaseUrl ??
    parsed.database_url ??
    parsed.connectionString ??
    parsed.connection_string ??
    parsed.url;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('PH-OS FeeRule Aurora database secret does not contain a connection URL');
  }
  return value.trim();
}

async function loadAuroraDatabaseUrl(deps: FeeRulesLambdaDependencies): Promise<string> {
  if (deps.databaseUrl) return deps.databaseUrl;
  const secretArn = deps.databaseSecretArn ?? process.env.PHOS_AURORA_DATABASE_SECRET_ARN;
  if (!secretArn) {
    throw new Error('PH-OS FeeRule Aurora database secret ARN is not configured');
  }
  const client =
    deps.secretsClient ?? withPhosAwsClientTimeout(new SecretsManagerClient(phosAwsClientConfig()));
  const secret = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (typeof secret.SecretString !== 'string') {
    throw new Error('PH-OS FeeRule Aurora database secret string is not configured');
  }
  return parseDatabaseUrlSecret(secret.SecretString);
}

export function createFeeRulesRepository(
  deps: FeeRulesLambdaDependencies = {},
): PhosFeeRulesRepository {
  if (deps.repository) return deps.repository;
  return createAuroraFeeRulesRepository({
    pool: deps.auroraPool,
    databaseUrl: deps.databaseUrl,
    now: deps.now,
  });
}

async function createFeeRulesRepositoryFromSecret(
  deps: FeeRulesLambdaDependencies = {},
): Promise<PhosFeeRulesRepository> {
  if (deps.repository || deps.auroraPool || deps.databaseUrl) return createFeeRulesRepository(deps);
  const databaseUrl = await loadAuroraDatabaseUrl(deps);
  return deps.repositoryFromDatabaseUrl
    ? deps.repositoryFromDatabaseUrl(databaseUrl)
    : createAuroraFeeRulesRepository({
        databaseUrl,
        now: deps.now,
      });
}

function createLazyFeeRulesRepository(
  deps: FeeRulesLambdaDependencies = {},
): PhosFeeRulesRepository {
  let repository: Promise<PhosFeeRulesRepository> | undefined;
  return {
    async searchFeeRules(ctx, query) {
      repository ??= createFeeRulesRepositoryFromSecret(deps);
      return (await repository).searchFeeRules(ctx, query);
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
