import { describe, expect, it } from 'vitest';
import { validateLightsailRuntimeEnv } from './aws-lightsail-runtime-env-validate';

const validEnv = `
APP_ENV=production
NEXT_PUBLIC_APP_ENV=production
AWS_REGION=ap-northeast-1
PORT=3000
HOSTNAME=0.0.0.0
DATABASE_URL=postgresql://phosadmin:secret@ph-os-db.example.aws:5432/ph_os?sslmode=require
DIRECT_URL=postgresql://phosadmin:secret@ph-os-db.example.aws:5432/ph_os?sslmode=require
NEXTAUTH_URL=https://ph-os.example.com
NEXT_PUBLIC_APP_URL=https://ph-os.example.com
NEXTAUTH_SECRET=0123456789abcdef0123456789abcdef
ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
JWT_SIGNING_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_abc123
NEXT_PUBLIC_COGNITO_CLIENT_ID=client123
COGNITO_CLIENT_SECRET=secret123
S3_BUCKET_NAME=ph-os-prod-files
SES_FROM_EMAIL=noreply@example.com
PHOS_DISABLE_LEGACY_FILE_API=1
RATE_LIMIT_STORE=dynamodb
RATE_LIMIT_DDB_TABLE_NAME=ph-os-rate-limit
AWS_CONTAINER_CREDENTIALS_RELATIVE_URI=/v2/credentials/app
`;

describe('validateLightsailRuntimeEnv', () => {
  it('passes a production env with HTTPS, TLS database URLs, and role credentials', () => {
    const report = validateLightsailRuntimeEnv({
      envFile: '.env.production.aws',
      envText: validEnv,
      now: new Date('2026-06-17T00:00:00Z'),
    });

    expect(report.summary).toEqual({ pass: 10, warn: 0, fail: 0, skip: 2 });
    expect(
      report.checks.find((check) => check.name === 'aws-runtime-credential-source')?.status,
    ).toBe('pass');
  });

  it('fails placeholders, non-HTTPS URLs, and missing sslmode=require', () => {
    const report = validateLightsailRuntimeEnv({
      envFile: '.env.production.aws',
      envText: validEnv
        .replace('https://ph-os.example.com', 'https://example.invalid')
        .replace('https://ph-os.example.com', 'http://localhost:3000')
        .replace('sslmode=require', 'sslmode=disable')
        .replace('client123', '<COGNITO_CLIENT_ID>'),
    });

    expect(report.checks.find((check) => check.name === 'placeholder-values')?.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'public-https-urls')?.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'database-url-tls')?.status).toBe('fail');
  });

  it('fails DynamoDB rate limiting without a role/container credential source', () => {
    const report = validateLightsailRuntimeEnv({
      envFile: '.env.production.aws',
      envText: validEnv.replace('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI=/v2/credentials/app', ''),
    });

    expect(
      report.checks.find((check) => check.name === 'aws-runtime-credential-source')?.status,
    ).toBe('fail');
  });

  it('fails static AWS keys in the runtime env file', () => {
    const report = validateLightsailRuntimeEnv({
      envFile: '.env.production.aws',
      envText: validEnv.replace(
        'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI=/v2/credentials/app',
        'AWS_ACCESS_KEY_ID=AKIASTATIC\nAWS_SECRET_ACCESS_KEY=static-secret',
      ),
    });

    const check = report.checks.find((item) => item.name === 'aws-runtime-credential-source');
    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('static AWS access keys');
  });

  it('fails weak or malformed production secrets', () => {
    const report = validateLightsailRuntimeEnv({
      envFile: '.env.production.aws',
      envText: validEnv
        .replace('NEXTAUTH_SECRET=0123456789abcdef0123456789abcdef', 'NEXTAUTH_SECRET=short')
        .replace(
          'ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
          'ENCRYPTION_KEY=short',
        )
        .replace(
          'JWT_SIGNING_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          'JWT_SIGNING_SECRET=short',
        ),
    });

    expect(report.checks.find((check) => check.name === 'secret-shape')?.status).toBe('fail');
  });
});
