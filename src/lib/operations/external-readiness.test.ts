import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getBackupDrillSummary, getPmdaOnboardingSummary } from './external-readiness';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const current = tempDirs.pop();
    if (current) {
      fs.rmSync(current, { recursive: true, force: true });
    }
  }
});

describe('external-readiness', () => {
  it('does not expose raw PMDA distribution URLs in the onboarding summary', () => {
    const summary = getPmdaOnboardingSummary({
      cwd: '/tmp',
      env: {
        NODE_ENV: 'test',
        PMDA_MEDINAVI_REGISTERED: 'true',
        PMDA_MY_DRUG_COLLECTION_REGISTERED: 'true',
        PMDA_PACKAGE_INSERT_FULL_URL: 'https://example.com/full.zip?token=secret',
        PMDA_PACKAGE_INSERT_DELTA_URL: 'https://example.com/delta.zip?token=secret',
      },
    });

    expect(summary.distribution_urls).toEqual({
      full_configured: true,
      delta_configured: true,
    });
    expect(summary).not.toHaveProperty('distribution_urls.full_url');
    expect(summary).not.toHaveProperty('distribution_urls.delta_url');
  });

  it('distinguishes tabletop drill records from live drill records', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'external-readiness-'));
    tempDirs.push(cwd);

    for (const filePath of [
      'docs/compliance/rds-configuration.md',
      'tools/infra/rds-aws-backup-template.yaml',
      'tools/scripts/aws-rds-backup-template-validate.ts',
      'tools/infra/file-storage-bucket-policy.json',
      'tools/infra/s3-kms-key-policy.json',
      'tools/infra/vpc-security-groups.json',
    ]) {
      const absolutePath = path.join(cwd, filePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, 'ok', 'utf8');
    }

    const drillDocPath = path.join(cwd, 'docs/compliance/backup-recovery-drill.md');
    fs.mkdirSync(path.dirname(drillDocPath), { recursive: true });
    fs.writeFileSync(
      drillDocPath,
      [
        '# backup drill',
        '',
        '| 実施日 | 実施者 | 結果 | 所要時間 | 備考 |',
        '| ---------- | ------ | -------------------- | -------- | ---------------------------------------------------------------------------------------- |',
        '| 2026-03-31 | 運用担当 | 机上訓練完了 | 45分 | [mode:tabletop] RDS/S3/Cognito の確認 |',
        '| 2026-04-01 | 運用担当 | live drill 完了 | 2時間15分 | [mode:live; environment=recovery-drill; ticket=INC-2026-0401; approver=運用責任者; started_at=2026-04-01T01:00:00.000Z; completed_at=2026-04-01T03:15:00.000Z; rto_minutes=135; rpo_minutes=20; health=passed; redaction=passed; samples=patients:10,reports:5,audit:20; summary=RDS PITR + S3 restore + Cognito] |',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = getBackupDrillSummary({
      cwd,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://example',
        AWS_REGION: 'ap-northeast-1',
      },
    });

    expect(summary.ready_for_live_drill).toBe(true);
    expect(summary.recorded_runs).toHaveLength(2);
    expect(summary.recorded_runs[0]).toMatchObject({
      date: '2026-03-31',
      mode: 'tabletop',
    });
    expect(summary.recorded_runs[1]).toMatchObject({
      date: '2026-04-01',
      mode: 'live',
      environment: 'recovery-drill',
      evidence_complete: true,
      started_at: '2026-04-01T01:00:00.000Z',
      completed_at: '2026-04-01T03:15:00.000Z',
      rto_minutes: 135,
      rpo_minutes: 20,
      health_status: 'passed',
      redaction_status: 'passed',
    });
    expect(summary.live_drill_recorded).toBe(true);
    expect(summary.live_run_count).toBe(1);
    expect(summary.last_live_run_date).toBe('2026-04-01');
  });

  it('does not count old live-looking rows as complete live recovery evidence', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'external-readiness-'));
    tempDirs.push(cwd);

    const drillDocPath = path.join(cwd, 'docs/compliance/backup-recovery-drill.md');
    fs.mkdirSync(path.dirname(drillDocPath), { recursive: true });
    fs.writeFileSync(
      drillDocPath,
      [
        '# backup drill',
        '',
        '| 実施日 | 実施者 | 結果 | 所要時間 | 備考 |',
        '| ---------- | ------ | -------------------- | -------- | ---------------------------------------------------------------------------------------- |',
        '| 2026-04-01 | 運用担当 | live drill 完了 | 2時間15分 | [mode:live] RDS PITR + S3 restore + Cognito |',
        '| 2026-04-02 | 運用担当 | 本番相当確認 | 2時間 | RDS/S3/Cognito live 確認 |',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = getBackupDrillSummary({
      cwd,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://example',
        AWS_REGION: 'ap-northeast-1',
      },
    });

    expect(summary.recorded_runs).toHaveLength(2);
    expect(summary.recorded_runs[0]).toMatchObject({
      mode: 'live',
      evidence_complete: false,
    });
    expect(summary.recorded_runs[1]).toMatchObject({
      mode: 'unknown',
      evidence_complete: false,
    });
    expect(summary.live_drill_recorded).toBe(false);
    expect(summary.live_run_count).toBe(0);
    expect(summary.last_live_run_date).toBeNull();
  });

  it('redacts unsafe recovery notes from summaries and refuses to treat them as complete evidence', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'external-readiness-'));
    tempDirs.push(cwd);

    const drillDocPath = path.join(cwd, 'docs/compliance/backup-recovery-drill.md');
    fs.mkdirSync(path.dirname(drillDocPath), { recursive: true });
    fs.writeFileSync(
      drillDocPath,
      [
        '# backup drill',
        '',
        '| 実施日 | 実施者 | 結果 | 所要時間 | 備考 |',
        '| ---------- | ------ | -------------------- | -------- | ---------------------------------------------------------------------------------------- |',
        '| 2026-04-01 | 運用担当 | live drill 完了 | 2時間15分 | [mode:live; environment=recovery-drill; ticket=INC-1; approver=責任者; started_at=2026-04-01T01:00:00.000Z; completed_at=2026-04-01T03:00:00.000Z; rto_minutes=120; rpo_minutes=30; health=passed; redaction=passed; samples=patients:10] arn:aws:rds:ap-northeast-1:123456789012:db:ph-os-prod https://example.com/file?X-Amz-Signature=secret 0312345678 患者名 山田太郎 |',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = getBackupDrillSummary({
      cwd,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://example',
        AWS_REGION: 'ap-northeast-1',
      },
    });
    const serialized = JSON.stringify(summary);

    expect(summary.recorded_runs[0]).toMatchObject({
      mode: 'live',
      evidence_complete: false,
      redaction_status: 'redacted',
    });
    expect(summary.live_drill_recorded).toBe(false);
    expect(serialized).not.toContain('123456789012');
    expect(serialized).not.toContain('arn:aws:rds');
    expect(serialized).not.toContain('X-Amz-Signature=secret');
    expect(serialized).not.toContain('0312345678');
    expect(serialized).not.toContain('山田太郎');
    expect(serialized).toContain('[redacted:aws_arn]');
  });

  it('does not let summary delimiter injection promote a tabletop row to live evidence', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'external-readiness-'));
    tempDirs.push(cwd);

    const drillDocPath = path.join(cwd, 'docs/compliance/backup-recovery-drill.md');
    fs.mkdirSync(path.dirname(drillDocPath), { recursive: true });
    fs.writeFileSync(
      drillDocPath,
      [
        '# backup drill',
        '',
        '| 実施日 | 実施者 | 結果 | 所要時間 | 備考 |',
        '| ---------- | ------ | -------------------- | -------- | ---------------------------------------------------------------------------------------- |',
        '| 2026-04-01 | ops | tabletop | 45分 | [mode:tabletop; summary=ok; mode:live; environment=recovery-drill; ticket=INC-1; approver=ops; started_at=2026-04-01T01:00:00.000Z; completed_at=2026-04-01T03:00:00.000Z; rto_minutes=120; rpo_minutes=30; health=passed; redaction=passed; samples=patients:10] |',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = getBackupDrillSummary({
      cwd,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://example',
        AWS_REGION: 'ap-northeast-1',
      },
    });

    expect(summary.recorded_runs[0]).toMatchObject({
      mode: 'tabletop',
      evidence_complete: false,
    });
    expect(summary.live_drill_recorded).toBe(false);
    expect(summary.live_run_count).toBe(0);
  });

  it('requires health=passed and row-wide safe evidence for complete live records', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'external-readiness-'));
    tempDirs.push(cwd);

    const drillDocPath = path.join(cwd, 'docs/compliance/backup-recovery-drill.md');
    fs.mkdirSync(path.dirname(drillDocPath), { recursive: true });
    fs.writeFileSync(
      drillDocPath,
      [
        '# backup drill',
        '',
        '| 実施日 | 実施者 | 結果 | 所要時間 | 備考 |',
        '| ---------- | ------ | -------------------- | -------- | ---------------------------------------------------------------------------------------- |',
        '| 2026-04-01 | ops | degraded drill | 120分 | [mode:live; environment=recovery-drill; ticket=INC-1; approver=ops; started_at=2026-04-01T01:00:00.000Z; completed_at=2026-04-01T03:00:00.000Z; rto_minutes=120; rpo_minutes=30; health=degraded; redaction=passed; samples=patients:10] |',
        '| 2026-04-02 | patient_id=pt_123 | complete | 120分 | [mode:live; environment=recovery-drill; ticket=INC-2; approver=ops; started_at=2026-04-02T01:00:00.000Z; completed_at=2026-04-02T03:00:00.000Z; rto_minutes=120; rpo_minutes=30; health=passed; redaction=passed; samples=patients:10] |',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = getBackupDrillSummary({
      cwd,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://example',
        AWS_REGION: 'ap-northeast-1',
      },
    });

    expect(summary.recorded_runs).toHaveLength(2);
    expect(summary.recorded_runs[0]).toMatchObject({
      mode: 'live',
      evidence_complete: false,
      health_status: 'degraded',
    });
    expect(summary.recorded_runs[1]).toMatchObject({
      mode: 'live',
      evidence_complete: false,
      redaction_status: 'redacted',
    });
    expect(summary.live_drill_recorded).toBe(false);
    expect(JSON.stringify(summary)).not.toContain('patient_id=pt_123');
  });
});
