import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateEcsExpressRuntimePolicyTemplate } from './aws-ecs-express-runtime-policy-validate';

const templatePath = 'tools/infra/ecs-express-runtime-policy-template.yaml';

describe('validateEcsExpressRuntimePolicyTemplate', () => {
  it('passes the committed ECS Express runtime policy contract', () => {
    const report = validateEcsExpressRuntimePolicyTemplate({
      templatePath,
      now: new Date('2026-06-17T00:00:00Z'),
    });

    expect(report.summary).toEqual({ pass: 5, warn: 0, fail: 0, skip: 1 });
    expect(report.checks.map((check) => check.name)).toContain('execution-role-secret-injection');
  });

  it('fails when ECS secret injection permissions are removed from the execution role', () => {
    const template = readFileSync(templatePath, 'utf8').replace(
      'EcsTaskExecutionSecretsPolicy:',
      'RemovedExecutionPolicy:',
    );

    const report = validateEcsExpressRuntimePolicyTemplate({
      templatePath,
      templateText: template,
    });

    expect(report.checks.find((check) => check.name === 'role-policy-resources')?.status).toBe(
      'fail',
    );
    expect(
      report.checks.find((check) => check.name === 'execution-role-secret-injection')?.status,
    ).toBe('fail');
  });

  it('fails wildcard IAM permissions and static AWS keys', () => {
    const template = `${readFileSync(templatePath, 'utf8')}\nResource: '*'\nAWS_SECRET_ACCESS_KEY=example`;

    const report = validateEcsExpressRuntimePolicyTemplate({
      templatePath,
      templateText: template,
    });

    expect(
      report.checks.find((check) => check.name === 'no-wildcards-or-static-keys')?.status,
    ).toBe('fail');
  });

  it('fails when approved S3 prefixes are widened', () => {
    const template = readFileSync(templatePath, 'utf8').replace(
      'arn:${AWS::Partition}:s3:::${EvidenceBucketName}/prescriptions/*',
      'arn:${AWS::Partition}:s3:::${EvidenceBucketName}/*',
    );

    const report = validateEcsExpressRuntimePolicyTemplate({
      templatePath,
      templateText: template,
    });

    expect(report.checks.find((check) => check.name === 's3-prefix-scope')?.status).toBe('fail');
  });
});
