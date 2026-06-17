import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateEcrTemplate } from './aws-ecr-template-validate';

const templatePath = 'tools/infra/ecr-repository-template.yaml';

describe('validateEcrTemplate', () => {
  it('passes the committed ECR repository cost and safety contract', () => {
    const report = validateEcrTemplate({
      templatePath,
      now: new Date('2026-06-17T00:00:00Z'),
    });

    expect(report.summary).toEqual({ pass: 5, warn: 0, fail: 0, skip: 1 });
    expect(report.checks.map((check) => check.name)).toContain('lifecycle-tagged-cap');
  });

  it('fails when encryption or lifecycle cleanup is removed', () => {
    const template = readFileSync(templatePath, 'utf8')
      .replace('EncryptionType: AES256', 'EncryptionType: KMS')
      .replace('Expire untagged images after 1 day', 'No cleanup');

    const report = validateEcrTemplate({
      templatePath,
      templateText: template,
    });

    expect(report.checks.find((check) => check.name === 'repository-encryption')?.status).toBe(
      'fail',
    );
    expect(report.checks.find((check) => check.name === 'lifecycle-untagged-cleanup')?.status).toBe(
      'fail',
    );
  });
});
