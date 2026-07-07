import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateRdsBackupTemplate } from './aws-rds-backup-template-validate';

const templatePath = 'tools/infra/rds-aws-backup-template.yaml';

describe('validateRdsBackupTemplate', () => {
  it('passes the committed RDS AWS Backup CloudFormation safety contract', () => {
    const report = validateRdsBackupTemplate({
      templatePath,
      now: new Date('2026-07-07T00:00:00Z'),
    });

    expect(report.summary).toEqual({ pass: 12, warn: 0, fail: 0, skip: 1 });
    expect(report.checks.map((check) => check.name)).toContain('continuous-pitr');
    expect(report.checks.map((check) => check.name)).toContain('restore-testing-optional');
    expect(report.checks.map((check) => check.name)).toContain('restore-testing-network-required');
    expect(report.checks.map((check) => check.name)).toContain(
      'restore-testing-safe-target-metadata',
    );
    expect(report.checks.map((check) => check.name)).toContain(
      'no-dangerous-application-permissions',
    );
  });

  it('fails when continuous PITR or explicit RDS selection is removed', () => {
    const template = readFileSync(templatePath, 'utf8')
      .replace('EnableContinuousBackup: true', 'EnableContinuousBackup: false')
      .replace(
        'Resources:\n          - !Ref RdsDbInstanceArn',
        'Resources:\n          # missing RDS resource selection',
      );

    const report = validateRdsBackupTemplate({
      templatePath,
      templateText: template,
    });

    expect(report.checks.find((check) => check.name === 'continuous-pitr')?.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'explicit-rds-selection')?.status).toBe(
      'fail',
    );
  });

  it('fails if a template grants destructive restore/delete permissions', () => {
    const template = `${readFileSync(templatePath, 'utf8')}\n# backup:StartRestoreJob\n# backup:UpdateRecoveryPointLifecycle\n# rds:RestoreDBInstanceToPointInTime\n# rds:ModifyDBInstance\n# rds:DeleteDBInstance\n# iam:PassRole\n# secretsmanager:PutSecretValue\n`;

    const report = validateRdsBackupTemplate({
      templatePath,
      templateText: template,
    });

    expect(
      report.checks.find((check) => check.name === 'no-dangerous-application-permissions')?.status,
    ).toBe('fail');
  });

  it('fails if restore testing network metadata is not explicit', () => {
    const template = readFileSync(templatePath, 'utf8')
      .replace('RestoreTestingNetworkRequired:', 'RestoreTestingNetworkMissing:')
      .replace('RestoreMetadataOverrides:', 'RestoreMetadataMissing:')
      .replace("publiclyAccessible: 'false'", "publiclyAccessible: 'true'");

    const report = validateRdsBackupTemplate({
      templatePath,
      templateText: template,
    });

    expect(
      report.checks.find((check) => check.name === 'restore-testing-network-required')?.status,
    ).toBe('fail');
    expect(
      report.checks.find((check) => check.name === 'restore-testing-safe-target-metadata')?.status,
    ).toBe('fail');
  });

  it('fails if runtime secrets are embedded in the template', () => {
    const template = `${readFileSync(templatePath, 'utf8')}\n# DATABASE_URL=postgresql://secret\n`;

    const report = validateRdsBackupTemplate({
      templatePath,
      templateText: template,
    });

    expect(report.checks.find((check) => check.name === 'no-secret-literals')?.status).toBe('fail');
  });
});
