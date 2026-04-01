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
      'infra/file-storage-bucket-policy.json',
      'infra/s3-kms-key-policy.json',
      'infra/vpc-security-groups.json',
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
        '|---|---|---|---|---|',
        '| 2026-03-31 | 運用担当 | 机上訓練完了 | 45分 | [mode:tabletop] RDS/S3/Cognito の確認 |',
        '| 2026-04-01 | 運用担当 | live drill 完了 | 2時間15分 | [mode:live] RDS PITR + S3 restore + Cognito |',
        '',
      ].join('\n'),
      'utf8'
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
    });
    expect(summary.live_drill_recorded).toBe(true);
    expect(summary.live_run_count).toBe(1);
    expect(summary.last_live_run_date).toBe('2026-04-01');
  });
});
