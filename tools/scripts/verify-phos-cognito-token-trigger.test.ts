import {
  DescribeUserPoolCommand,
  type DescribeUserPoolCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
import { describe, expect, it, vi } from 'vitest';
import {
  evaluateCognitoPreTokenGenerationProof,
  verifyCognitoPreTokenGenerationLiveProof,
} from './verify-phos-cognito-token-trigger';

const user_pool_id = 'ap-northeast-1_example';
const expected_lambda_arn =
  'arn:aws:lambda:ap-northeast-1:123456789012:function:phos-prod-cognito-token';

describe('verify-phos-cognito-token-trigger', () => {
  it('accepts Cognito Pre Token Generation V2 access-token customization config', () => {
    expect(
      evaluateCognitoPreTokenGenerationProof({
        user_pool_id,
        expected_lambda_arn,
        lambda_config: {
          PreTokenGeneration: expected_lambda_arn,
          PreTokenGenerationConfig: {
            LambdaArn: expected_lambda_arn,
            LambdaVersion: 'V2_0',
          },
        },
      }),
    ).toEqual({
      ok: true,
      user_pool_id,
      pre_token_generation_lambda_arn: expected_lambda_arn,
      lambda_version: 'V2_0',
      legacy_pre_token_generation_arn: expected_lambda_arn,
    });
  });

  it('accepts V3 without a legacy PreTokenGeneration mirror', () => {
    expect(
      evaluateCognitoPreTokenGenerationProof({
        user_pool_id,
        expected_lambda_arn,
        lambda_config: {
          PreTokenGenerationConfig: {
            LambdaArn: expected_lambda_arn,
            LambdaVersion: 'V3_0',
          },
        },
      }).legacy_pre_token_generation_arn,
    ).toBeNull();
  });

  it('rejects legacy-only trigger attachment because it cannot prove access-token claims', () => {
    expect(() =>
      evaluateCognitoPreTokenGenerationProof({
        user_pool_id,
        expected_lambda_arn,
        lambda_config: {
          PreTokenGeneration: expected_lambda_arn,
        },
      }),
    ).toThrow('LambdaConfig.PreTokenGenerationConfig');
  });

  it('rejects a different attached Lambda ARN', () => {
    expect(() =>
      evaluateCognitoPreTokenGenerationProof({
        user_pool_id,
        expected_lambda_arn,
        lambda_config: {
          PreTokenGenerationConfig: {
            LambdaArn: `${expected_lambda_arn}-old`,
            LambdaVersion: 'V2_0',
          },
        },
      }),
    ).toThrow('LambdaArn mismatch');
  });

  it('rejects V1 because PH-OS must add tenant and role claims to access tokens', () => {
    expect(() =>
      evaluateCognitoPreTokenGenerationProof({
        user_pool_id,
        expected_lambda_arn,
        lambda_config: {
          PreTokenGenerationConfig: {
            LambdaArn: expected_lambda_arn,
            LambdaVersion: 'V1_0',
          },
        },
      }),
    ).toThrow('LambdaVersion must be V2_0 or V3_0');
  });

  it('uses DescribeUserPool for the live proof path', async () => {
    const send = vi.fn(
      async (command: DescribeUserPoolCommand, options?: { abortSignal?: AbortSignal }) => {
        expect(command).toBeInstanceOf(DescribeUserPoolCommand);
        expect(command.input).toEqual({ UserPoolId: user_pool_id });
        expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
        const response: DescribeUserPoolCommandOutput = {
          $metadata: {},
          UserPool: {
            LambdaConfig: {
              PreTokenGenerationConfig: {
                LambdaArn: expected_lambda_arn,
                LambdaVersion: 'V2_0',
              },
            },
          },
        };
        return response;
      },
    );

    await expect(
      verifyCognitoPreTokenGenerationLiveProof({
        user_pool_id,
        expected_lambda_arn,
        client: {
          send(command) {
            return send(command, { abortSignal: new AbortController().signal });
          },
        },
      }),
    ).resolves.toMatchObject({ ok: true, lambda_version: 'V2_0' });
    expect(send).toHaveBeenCalledOnce();
  });
});
