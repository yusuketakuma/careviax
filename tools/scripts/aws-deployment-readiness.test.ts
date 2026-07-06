import { describe, expect, it } from 'vitest';
import { evaluateReadiness, type ReadinessInput } from './aws-deployment-readiness';

function baseInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    commands: {
      aws: { found: true, version: 'aws-cli/2.35.6' },
      docker: { found: true, version: 'Docker version 1.0.0' },
      node: { found: true, version: 'v24.16.0' },
      pnpm: { found: true, version: '11.5.2' },
    },
    files: {
      dockerfile: true,
      dockerignore: true,
      nextConfig: "const nextConfig = { output: 'standalone' };",
      costScenarios: true,
      operationsDoc: true,
      s3BucketPolicy: true,
      s3BucketPolicyText:
        '/prescriptions/* /consent-documents/* /visit-photos/* /reports/* /set-audits/* /contract-documents/* /bulk-exports/*',
      s3ObjectLockPolicy: true,
      s3KmsKeyPolicy: true,
      fileApiBoundaryTests: [
        'src/app/api/__tests__/api-conventions-static.test.ts',
        'src/app/api/files/presigned-upload/route.test.ts',
        'src/app/api/files/complete/route.test.ts',
        'src/app/api/files/[id]/presigned-download/route.test.ts',
        'src/app/api/files/[id]/download/route.test.ts',
      ],
      standaloneServer: true,
      standaloneEnvFiles: [],
    },
    env: {
      AWS_REGION: 'ap-northeast-1',
      DATABASE_URL: 'postgresql://example',
      NEXTAUTH_URL: 'https://example.test',
      NEXTAUTH_SECRET: 'secret',
      NEXT_PUBLIC_APP_URL: 'https://example.test',
      ENCRYPTION_KEY: 'key',
      JWT_SIGNING_SECRET: 'jwt',
    },
    liveAws: { attempted: false, ok: false, message: 'not attempted' },
    ...overrides,
  };
}

describe('evaluateReadiness', () => {
  it('passes local AWS deployment prerequisites when artifacts and env are present', () => {
    const report = evaluateReadiness(baseInput(), new Date('2026-06-17T00:00:00.000Z'));

    expect(report.summary).toEqual({ pass: 14, warn: 0, fail: 0, skip: 1 });
    expect(report.checks.find((check) => check.name === 'aws-credentials')?.status).toBe('skip');
  });

  it('warns when Docker and production env are missing but does not fail by default', () => {
    const input = baseInput({
      commands: {
        ...baseInput().commands,
        docker: { found: false },
      },
      env: {
        AWS_REGION: 'ap-northeast-1',
      },
    });

    const report = evaluateReadiness(input);

    expect(report.checks.find((check) => check.name === 'docker')?.status).toBe('warn');
    expect(report.checks.find((check) => check.name === 'production-env')?.status).toBe('warn');
    expect(report.summary.fail).toBe(0);
    expect(report.summary.warn).toBe(2);
  });

  it('fails when required build assets or AWS CLI are absent', () => {
    const input = baseInput({
      commands: {
        ...baseInput().commands,
        aws: { found: false },
      },
      files: {
        ...baseInput().files,
        dockerfile: false,
        nextConfig: 'const nextConfig = {};',
      },
      liveAws: {
        attempted: true,
        ok: false,
        message: 'AWS credential check failed: NoCredentials',
      },
    });

    const report = evaluateReadiness(input);

    expect(report.checks.find((check) => check.name === 'aws-cli')?.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'dockerfile')?.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'next-standalone-config')?.status).toBe(
      'fail',
    );
    expect(report.checks.find((check) => check.name === 'aws-credentials')?.status).toBe('fail');
  });

  it('fails when S3 PHI policy artifacts or file API boundary tests are absent', () => {
    const report = evaluateReadiness(
      baseInput({
        files: {
          ...baseInput().files,
          s3BucketPolicy: false,
          s3BucketPolicyText: '/prescriptions/* /visit-photos/* /reports/* /bulk-exports/*',
          fileApiBoundaryTests: [
            'src/app/api/__tests__/api-conventions-static.test.ts',
            'src/app/api/files/complete/route.test.ts',
          ],
        },
      }),
    );

    expect(report.checks.find((check) => check.name === 's3-phi-policy-artifacts')?.status).toBe(
      'fail',
    );
    expect(
      report.checks.find((check) => check.name === 'file-api-public-dto-boundary')?.status,
    ).toBe('fail');
  });

  it('fails when standalone output contains copied environment files', () => {
    const report = evaluateReadiness(
      baseInput({
        files: {
          ...baseInput().files,
          standaloneEnvFiles: ['.env'],
        },
      }),
    );

    expect(
      report.checks.find((check) => check.name === 'next-standalone-secret-files')?.status,
    ).toBe('fail');
  });
});
