import { describe, expect, it, vi } from 'vitest';
import {
  buildPhosBackendLiveReadinessReport,
  evaluateAccessTokenReadiness,
  evaluateLegacyNextApiBoundaryReadiness,
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
      detail: expect.stringContaining('canonical HTTP API/JWT authorizer'),
    });
  });

  it('records the accepted HTTP API observability contract in local readiness', () => {
    expect(evaluateLocalTemplateReadiness()).toMatchObject({
      name: 'local_template_contract',
      status: 'passed',
      detail: expect.stringContaining('PHI-minimized access logs, Lambda active tracing'),
    });
  });

  it('requires canonical PH-OS structured field names in HTTP API access logs', () => {
    expect(evaluateLocalTemplateReadiness()).toMatchObject({
      name: 'local_template_contract',
      status: 'passed',
      detail: expect.stringContaining('PHI-minimized access logs'),
    });
  });

  it('rejects explicit legacy Next file API compatibility in PH-OS production readiness', () => {
    expect(
      evaluateLegacyNextApiBoundaryReadiness({
        APP_ENV: 'production',
        PHOS_ENABLE_LEGACY_FILE_API: '1',
      }),
    ).toMatchObject({
      name: 'legacy_next_file_api_boundary',
      status: 'failed',
      detail: expect.stringContaining('PHOS_ENABLE_LEGACY_FILE_API must not be true'),
    });
  });

  it('allows missing legacy compatibility override because production fails closed by default', () => {
    expect(
      evaluateLegacyNextApiBoundaryReadiness({
        APP_ENV: 'production',
      }),
    ).toMatchObject({
      name: 'legacy_next_file_api_boundary',
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
          scope: 'phos/cards.read',
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
          scp: ['phos/cards.read'],
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
          scope: 'phos/cards.read',
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
          scope: 'phos/cards.read',
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
          scope: 'phos/cards.read',
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

  it('rejects access tokens with scope typos or unknown roles before live smoke proof', () => {
    for (const payload of [
      {
        ...validTemporalClaims,
        tenant_id: 'tenant_abc123',
        role: 'PHARMACIST',
        sub: 'user_001',
        scope: 'phos/cards:read',
      },
      {
        ...validTemporalClaims,
        tenant_id: 'tenant_abc123',
        role: 'OWNER',
        sub: 'user_001',
        scope: 'phos/cards.read',
      },
      {
        ...validTemporalClaims,
        tenant_id: 'tenant_abc123',
        role: 'PHARMACIST',
        sub: 'user_001',
        scp: ['phos/unknown.read'],
      },
    ]) {
      expect(evaluateAccessTokenReadiness(jwt(payload), { now })).toMatchObject({
        name: 'access_token_claims',
        status: 'failed',
      });
    }
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
          name: 'legacy_next_file_api_boundary',
          status: 'passed',
        }),
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

  it('fails readiness when PH-OS production explicitly enables legacy Next file APIs', async () => {
    await expect(
      buildPhosBackendLiveReadinessReport({
        env: {
          APP_ENV: 'production',
          PHOS_ENABLE_LEGACY_FILE_API: 'true',
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: 'legacy_next_file_api_boundary',
          status: 'failed',
        }),
      ]),
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
          scope: 'phos/cards.read',
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

  it('keeps the readiness report machine-readable when the API smoke fetch fails', async () => {
    const report = await buildPhosBackendLiveReadinessReport({
      env: {
        PHOS_COGNITO_ACCESS_TOKEN: jwt({
          ...validTemporalClaims,
          tenant_id: 'tenant_abc123',
          role: 'PHARMACIST',
          sub: 'user_001',
          scope: 'phos/cards.read',
        }),
        PHOS_API_BASE_URL: 'https://api.example.test',
      },
      now,
      fetch: async () => {
        throw new TypeError('network unreachable');
      },
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'api_gateway_lambda_smoke',
          status: 'failed',
          detail: 'GET /cards request failed: network unreachable',
        }),
      ]),
    );
  });

  it('bounds the API smoke fetch with a readiness timeout', async () => {
    vi.useFakeTimers();
    try {
      let observedSignal: AbortSignal | undefined;
      const reportPromise = buildPhosBackendLiveReadinessReport({
        env: {
          PHOS_COGNITO_ACCESS_TOKEN: jwt({
            ...validTemporalClaims,
            tenant_id: 'tenant_abc123',
            role: 'PHARMACIST',
            sub: 'user_001',
            scope: 'phos/cards.read',
          }),
          PHOS_API_BASE_URL: 'https://api.example.test',
          PHOS_BACKEND_LIVE_SMOKE_TIMEOUT_MS: '5',
        },
        now,
        fetch: async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            observedSignal = init?.signal ?? undefined;
            observedSignal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      });

      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(5);
      const report = await reportPromise;

      expect(observedSignal?.aborted).toBe(true);
      expect(report.ok).toBe(false);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'api_gateway_lambda_smoke',
            status: 'failed',
            detail: 'GET /cards request timed out after 5 ms.',
          }),
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the API smoke check before fetch when the API base URL carries unsafe URL parts', async () => {
    const fetchImpl = async () => {
      throw new Error('fetch should not run for invalid PHOS_API_BASE_URL');
    };
    const report = await buildPhosBackendLiveReadinessReport({
      env: {
        PHOS_COGNITO_ACCESS_TOKEN: jwt({
          ...validTemporalClaims,
          tenant_id: 'tenant_abc123',
          role: 'PHARMACIST',
          sub: 'user_001',
          scope: 'phos/cards.read',
        }),
        PHOS_API_BASE_URL: 'https://token:secret@api.example.test/prod?debug=1#cards',
      },
      now,
      fetch: fetchImpl,
    });

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'api_gateway_lambda_smoke',
          status: 'failed',
          detail: 'PHOS_API_BASE_URL must not include credentials, query, or fragment.',
        }),
      ]),
    );
  });

  it('preserves API Gateway stage paths when building the API smoke URL', async () => {
    let requestedUrl: string | undefined;
    let requestedInit: RequestInit | undefined;
    const report = await buildPhosBackendLiveReadinessReport({
      env: {
        PHOS_COGNITO_ACCESS_TOKEN: jwt({
          ...validTemporalClaims,
          tenant_id: 'tenant_abc123',
          role: 'PHARMACIST',
          sub: 'user_001',
          scope: 'phos/cards.read',
        }),
        PHOS_API_BASE_URL: 'https://api.example.test/prod',
      },
      now,
      fetch: async (input, init) => {
        requestedUrl = input.toString();
        requestedInit = init;
        return new Response('{}', { status: 200 });
      },
    });

    expect(requestedUrl).toBe('https://api.example.test/prod/cards');
    expect(requestedInit).toEqual(
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        headers: { Authorization: expect.stringContaining('Bearer ') },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'api_gateway_lambda_smoke',
          status: 'passed',
        }),
      ]),
    );
  });
});
