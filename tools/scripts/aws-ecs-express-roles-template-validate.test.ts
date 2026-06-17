import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateEcsExpressRolesTemplate } from './aws-ecs-express-roles-template-validate';

const templatePath = 'tools/infra/ecs-express-roles-template.yaml';

describe('validateEcsExpressRolesTemplate', () => {
  it('passes the committed ECS Express roles contract', () => {
    const report = validateEcsExpressRolesTemplate({
      templatePath,
      now: new Date('2026-06-17T00:00:00Z'),
    });

    expect(report.summary).toEqual({ pass: 5, warn: 0, fail: 0, skip: 1 });
    expect(report.checks.map((check) => check.name)).toContain('infrastructure-role');
  });

  it('fails when required trust or managed policies are removed', () => {
    const template = readFileSync(templatePath, 'utf8')
      .replace('Service: ecs.amazonaws.com', '')
      .replace('arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy', '');

    const report = validateEcsExpressRolesTemplate({
      templatePath,
      templateText: template,
    });

    expect(report.checks.find((check) => check.name === 'task-execution-role')?.status).toBe(
      'fail',
    );
    expect(report.checks.find((check) => check.name === 'infrastructure-role')?.status).toBe(
      'fail',
    );
  });

  it('fails static keys and wildcard runtime resource permissions', () => {
    const template = `${readFileSync(templatePath, 'utf8')}\nAWS_ACCESS_KEY_ID=example\nResource: '*'`;

    const report = validateEcsExpressRolesTemplate({
      templatePath,
      templateText: template,
    });

    expect(
      report.checks.find((check) => check.name === 'no-static-keys-or-wildcard-resources')?.status,
    ).toBe('fail');
  });
});
