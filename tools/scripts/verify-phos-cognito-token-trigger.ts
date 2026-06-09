import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  type DescribeUserPoolCommandOutput,
  type LambdaConfigType,
} from '@aws-sdk/client-cognito-identity-provider';

const ACCESS_TOKEN_CUSTOMIZATION_VERSIONS = new Set(['V2_0', 'V3_0']);

export type CognitoPreTokenGenerationProof = {
  ok: true;
  user_pool_id: string;
  pre_token_generation_lambda_arn: string;
  lambda_version: string;
  legacy_pre_token_generation_arn: string | null;
};

export type CognitoPreTokenGenerationProofInput = {
  user_pool_id: string;
  expected_lambda_arn: string;
  lambda_config: LambdaConfigType | undefined;
};

type CognitoSender = {
  send(command: DescribeUserPoolCommand): Promise<DescribeUserPoolCommandOutput>;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function evaluateCognitoPreTokenGenerationProof(
  input: CognitoPreTokenGenerationProofInput,
): CognitoPreTokenGenerationProof {
  const trigger = input.lambda_config?.PreTokenGenerationConfig;
  const legacyArn = input.lambda_config?.PreTokenGeneration?.trim() || null;
  const configuredArn = trigger?.LambdaArn?.trim();
  const lambdaVersion = trigger?.LambdaVersion?.trim();

  if (!trigger || !configuredArn || !lambdaVersion) {
    throw new Error('Cognito user pool is missing LambdaConfig.PreTokenGenerationConfig');
  }
  if (configuredArn !== input.expected_lambda_arn) {
    throw new Error(
      `Cognito PreTokenGenerationConfig LambdaArn mismatch: expected ${input.expected_lambda_arn}, got ${configuredArn}`,
    );
  }
  if (legacyArn && legacyArn !== input.expected_lambda_arn) {
    throw new Error(
      `Cognito legacy PreTokenGeneration ARN mismatch: expected ${input.expected_lambda_arn}, got ${legacyArn}`,
    );
  }
  if (!ACCESS_TOKEN_CUSTOMIZATION_VERSIONS.has(lambdaVersion)) {
    throw new Error(
      `Cognito PreTokenGenerationConfig LambdaVersion must be V2_0 or V3_0 for PH-OS access-token claims: got ${lambdaVersion}`,
    );
  }

  return {
    ok: true,
    user_pool_id: input.user_pool_id,
    pre_token_generation_lambda_arn: configuredArn,
    lambda_version: lambdaVersion,
    legacy_pre_token_generation_arn: legacyArn,
  };
}

export async function verifyCognitoPreTokenGenerationLiveProof(input: {
  user_pool_id: string;
  expected_lambda_arn: string;
  client: CognitoSender;
}): Promise<CognitoPreTokenGenerationProof> {
  const response = await input.client.send(
    new DescribeUserPoolCommand({ UserPoolId: input.user_pool_id }),
  );
  return evaluateCognitoPreTokenGenerationProof({
    user_pool_id: input.user_pool_id,
    expected_lambda_arn: input.expected_lambda_arn,
    lambda_config: response.UserPool?.LambdaConfig,
  });
}

async function main() {
  const region = requireEnv('AWS_REGION');
  const user_pool_id = requireEnv('PHOS_COGNITO_USER_POOL_ID');
  const expected_lambda_arn = requireEnv('PHOS_COGNITO_PRE_TOKEN_GENERATION_FUNCTION_ARN');
  const proof = await verifyCognitoPreTokenGenerationLiveProof({
    user_pool_id,
    expected_lambda_arn,
    client: new CognitoIdentityProviderClient({ region }),
  });

  console.log(JSON.stringify(proof, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
