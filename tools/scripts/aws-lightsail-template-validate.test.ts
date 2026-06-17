import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateLightsailTemplate } from './aws-lightsail-template-validate';

const templatePath = 'tools/infra/lightsail-pilot-template.yaml';

describe('validateLightsailTemplate', () => {
  it('passes the committed Lightsail pilot CloudFormation safety contract', () => {
    const report = validateLightsailTemplate({
      templatePath,
      now: new Date('2026-06-17T00:00:00Z'),
    });

    expect(report.summary).toEqual({ pass: 6, warn: 0, fail: 0, skip: 1 });
    expect(report.checks.map((check) => check.name)).toContain('database-safety');
    expect(report.checks.map((check) => check.name)).toContain('no-secret-literals');
  });

  it('fails if the database is public or password is not protected', () => {
    const template = readFileSync(templatePath, 'utf8')
      .replace('PubliclyAccessible: false', 'PubliclyAccessible: true')
      .replace('NoEcho: true', 'NoEcho: false');

    const report = validateLightsailTemplate({
      templatePath,
      templateText: template,
    });

    expect(report.checks.find((check) => check.name === 'database-safety')?.status).toBe('fail');
    expect(
      report.checks.find((check) => check.name === 'database-password-parameter')?.status,
    ).toBe('fail');
  });

  it('fails if runtime secrets are embedded in user data', () => {
    const template = `${readFileSync(templatePath, 'utf8')}\n# DATABASE_URL=postgresql://secret\n`;

    const report = validateLightsailTemplate({
      templatePath,
      templateText: template,
    });

    expect(report.checks.find((check) => check.name === 'no-secret-literals')?.status).toBe('fail');
  });
});
