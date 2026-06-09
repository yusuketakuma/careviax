import { describe, expect, it } from 'vitest';
import {
  buildPhosBackendLiveReadinessReport,
  evaluateAccessTokenReadiness,
  evaluateLocalTemplateReadiness,
} from './verify-phos-backend-live-readiness';

function jwt(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

describe('verify-phos-backend-live-readiness', () => {
  const now = new Date('2026-06-10T00:00:00.000Z');
  const validTemporalClaims = {
    token_use: 'access',
    exp: Math.floor(now.getTime() / 1000) + 3600,
    iat: Math.floor(now.getTime() / 1000) - 60,
    nbf: Math.floor(now.getTime() / 1000) - 60,
  };

  it('passes the local deployment template contract readiness check', () => {
    expect(evaluateLocalTemplateReadiness()).toMatchObject({
      name: 'local_template_contract',
      status: 'passed',
    });
  });

  it('accepts access tokens with PH-OS canonical claims and scope', () => {
    expect(
      evaluateAccessTokenReadiness(
        jwt({
          ...validTemporalClaims,
          tenant_id: 'tenant_abc123',
          role: 'PHARMACIST',
          sub: 'user_001',
          scope: 'phos/cards:read',
        }),
        { now },
      ),
    ).toMatchObject({
      name: 'access_token_claims',
      status: 'passed',
    });
  });

  it('accepts scp array claims as API Gateway compatible scope evidence', () => {
    expect(
      evaluateAccessTokenReadiness(
        jwt({
          ...validTemporalClaims,
          tenant_id: 'tenant_abc123',
          role: 'PHARMACIST',
          sub: 'user_001',
          scp: ['phos/cards:read'],
        }),
        { now },
      ),
    ).toMatchObject({
      name: 'access_token_claims',
      status: 'passed',
    });
  });

  it('rejects access tokens that only carry legacy custom attributes', () => {
    expect(
      evaluateAccessTokenReadiness(
        jwt({
          'custom:tenant_id': 'tenant_abc123',
          'custom:role': 'PHARMACIST',
          ...validTemporalClaims,
          sub: 'user_001',
          scope: 'phos/cards:read',
        }),
        { now },
      ),
    ).toMatchObject({
      name: 'access_token_claims',
      status: 'failed',
      detail: expect.stringContaining('tenant_id'),
    });
  });

  it('rejects expired or ID-token-like JWT payloads', () => {
    expect(
      evaluateAccessTokenReadiness(
        jwt({
          ...validTemporalClaims,
          token_use: 'id',
          exp: Math.floor(now.getTime() / 1000) - 1,
          tenant_id: 'tenant_abc123',
          role: 'PHARMACIST',
          sub: 'user_001',
          scope: 'phos/cards:read',
        }),
        { now },
      ),
    ).toMatchObject({
      name: 'access_token_claims',
      status: 'failed',
      detail: expect.stringContaining('token_use=access'),
    });
  });

  it('validates JWT issuer and audience when expected values are supplied', () => {
    expect(
      evaluateAccessTokenReadiness(
        jwt({
          ...validTemporalClaims,
          iss: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_pool',
          client_id: 'client_123',
          tenant_id: 'tenant_abc123',
          role: 'PHARMACIST',
          sub: 'user_001',
          scope: 'phos/cards:read',
        }),
        {
          now,
          issuer: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_pool',
          audience: 'client_123',
        },
      ),
    ).toMatchObject({
      name: 'access_token_claims',
      status: 'passed',
    });
  });

  it('reports missing live inputs without failing non-strict readiness', async () => {
    await expect(
      buildPhosBackendLiveReadinessReport({
        env: {},
        now: new Date('2026-06-10T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      ok: true,
      strict: false,
      missing_inputs: [
        'AWS_REGION',
        'PHOS_API_BASE_URL',
        'PHOS_COGNITO_ACCESS_TOKEN',
        'PHOS_COGNITO_PRE_TOKEN_GENERATION_FUNCTION_ARN',
        'PHOS_COGNITO_USER_POOL_ID',
        'PHOS_JWT_AUDIENCE',
        'PHOS_JWT_ISSUER',
      ],
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: 'cognito_trigger_live_attachment',
          status: 'missing',
        }),
        expect.objectContaining({
          name: 'api_gateway_lambda_smoke',
          status: 'missing',
        }),
      ]),
    });
  });

  it('fails strict readiness when live inputs are missing', async () => {
    await expect(
      buildPhosBackendLiveReadinessReport({
        env: {},
        strict: true,
      }),
    ).resolves.toMatchObject({
      ok: false,
      strict: true,
    });
  });

  it('fails the API smoke check for non-2xx responses', async () => {
    const report = await buildPhosBackendLiveReadinessReport({
      env: {
        PHOS_COGNITO_ACCESS_TOKEN: jwt({
          ...validTemporalClaims,
          tenant_id: 'tenant_abc123',
          role: 'PHARMACIST',
          sub: 'user_001',
          scope: 'phos/cards:read',
        }),
        PHOS_API_BASE_URL: 'https://api.example.test',
      },
      now,
      fetch: async () => new Response('{}', { status: 500 }),
    });

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'api_gateway_lambda_smoke',
          status: 'failed',
          detail: 'GET /cards returned HTTP 500.',
        }),
      ]),
    );
  });
});
