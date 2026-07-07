import { describe, expect, it, vi } from 'vitest';
import {
  assertRecoveryIntegrityTargetAllowed,
  formatRecoveryIntegrityCliError,
  isProductionLikeDatabaseUrl,
  parseRecoveryIntegrityAuditArgs,
  RECOVERY_INTEGRITY_CHECKS_SQL,
  RECOVERY_INTEGRITY_COUNTS_SQL,
  runRecoveryIntegrityAudit,
  serializeRecoveryIntegrityAudit,
} from './backup-recovery-integrity-audit';

describe('backup-recovery-integrity-audit', () => {
  it('runs SELECT-only count and integrity checks with PHI-free output', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            category: 'patients',
            row_count: '12',
            latest_at: '2026-07-08T01:00:00.000Z',
          },
          {
            category: 'audit_logs',
            row_count: '42',
            latest_at: '2026-07-08T01:15:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            check_key: 'visit_record_missing_patient',
            severity: 'error',
            issue_count: '0',
          },
          {
            check_key: 'care_report_missing_patient',
            severity: 'error',
            issue_count: '0',
          },
        ],
      });

    const report = await runRecoveryIntegrityAudit({
      client: { query },
      productionLike: false,
      allowProduction: false,
      now: new Date('2026-07-08T02:00:00.000Z'),
    });

    expect(report.ok).toBe(true);
    expect(report.counts).toEqual([
      {
        category: 'patients',
        count: 12,
        latest_at: '2026-07-08T01:00:00.000Z',
      },
      {
        category: 'audit_logs',
        count: 42,
        latest_at: '2026-07-08T01:15:00.000Z',
      },
    ]);
    expect(report.rpo_hint).toMatchObject({
      latest_observed_data_at: '2026-07-08T01:00:00.000Z',
      latest_observed_source_category: 'patients',
      minutes_since_latest_observed_data_at: 60,
      basis: 'critical_operational_categories',
      status: 'not_configured',
    });
    expect(query).toHaveBeenNthCalledWith(1, RECOVERY_INTEGRITY_COUNTS_SQL);
    expect(query).toHaveBeenNthCalledWith(2, RECOVERY_INTEGRITY_CHECKS_SQL);

    const serialized = serializeRecoveryIntegrityAudit(report, 'json');
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('patient_id');
    expect(serialized).not.toContain('s3://');
    expect(serialized).not.toContain('patients/raw/');
    expect(serialized).not.toContain('arn:aws');
    expect(serialized).not.toContain('DATABASE_URL');
  });

  it('fails when an integrity check has orphaned rows', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            category: 'patients',
            row_count: '1',
            latest_at: '2026-07-08T01:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            check_key: 'medication_stock_event_missing_item',
            severity: 'error',
            issue_count: '3',
          },
        ],
      });

    const report = await runRecoveryIntegrityAudit({
      client: { query },
      productionLike: false,
      allowProduction: false,
      now: new Date('2026-07-08T02:00:00.000Z'),
    });

    expect(report.ok).toBe(false);
    expect(report.integrity_checks).toEqual([
      {
        check_key: 'medication_stock_event_missing_item',
        severity: 'error',
        issue_count: 3,
        status: 'fail',
      },
    ]);
  });

  it('does not let audit logs alone satisfy the optional RPO helper', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            category: 'audit_logs',
            row_count: '5',
            latest_at: '2026-07-08T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            check_key: 'audit_log_missing_patient',
            severity: 'error',
            issue_count: '0',
          },
        ],
      });

    const report = await runRecoveryIntegrityAudit({
      client: { query },
      productionLike: false,
      allowProduction: false,
      expectedLatestAt: '2026-07-08T02:00:00.000Z',
      rpoMinutes: 30,
      now: new Date('2026-07-08T02:30:00.000Z'),
    });

    expect(report.ok).toBe(false);
    expect(report.rpo_hint).toMatchObject({
      latest_observed_data_at: null,
      latest_observed_source_category: null,
      expected_latest_at: '2026-07-08T02:00:00.000Z',
      rpo_minutes: 30,
      basis: 'critical_operational_categories',
      status: 'unknown',
    });
  });

  it('rejects production-like database targets unless explicitly allowed', () => {
    const databaseUrl =
      'postgresql://phos:secret@ph-os-prod.abc123.ap-northeast-1.rds.amazonaws.com:5432/ph_os';

    expect(isProductionLikeDatabaseUrl(databaseUrl, {})).toBe(true);
    expect(() =>
      assertRecoveryIntegrityTargetAllowed({
        databaseUrl,
        allowProduction: false,
        env: {},
      }),
    ).toThrow(/production-like/);
    expect(
      assertRecoveryIntegrityTargetAllowed({
        databaseUrl,
        allowProduction: true,
        env: {},
      }),
    ).toBe(true);
  });

  it('detects production-like target tokens without treating product_catalog as prod', () => {
    const productionLikeUrls = [
      'postgresql://phos:secret@localhost:5432/ph_os_prod',
      'postgresql://phos:secret@localhost:5432/careviax_prod_restore',
      'postgresql://phos:secret@localhost:5432/ph-os-prd',
      'postgresql://phos:secret@localhost:5432/live',
      'postgresql://phos:secret@localhost:5432/primary',
    ];
    for (const databaseUrl of productionLikeUrls) {
      expect(isProductionLikeDatabaseUrl(databaseUrl, {}), databaseUrl).toBe(true);
    }
    expect(
      isProductionLikeDatabaseUrl(
        'postgresql://phos:secret@localhost:5432/product_catalog_restore',
        {},
      ),
    ).toBe(false);
  });

  it('parses output and RPO arguments before DATABASE_URL is required by the CLI', () => {
    expect(
      parseRecoveryIntegrityAuditArgs([
        '--markdown',
        '--allow-production',
        '--expected-latest-at',
        '2026-07-08T02:00:00+09:00',
        '--rpo-minutes',
        '60',
      ]),
    ).toEqual({
      format: 'markdown',
      allowProduction: true,
      expectedLatestAt: '2026-07-07T17:00:00.000Z',
      rpoMinutes: 60,
    });
    expect(() =>
      parseRecoveryIntegrityAuditArgs(['--expected-latest-at', '2026-07-08T02:00:00Z']),
    ).toThrow(/セット/);
    expect(() => parseRecoveryIntegrityAuditArgs(['--rpo-minutes', '60'])).toThrow(/セット/);
  });

  it('fails closed on invalid database counts', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            category: 'patients',
            row_count: 'NaN',
            latest_at: '2026-07-08T01:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      runRecoveryIntegrityAudit({
        client: { query },
        productionLike: false,
        allowProduction: false,
        now: new Date('2026-07-08T02:00:00.000Z'),
      }),
    ).rejects.toThrow(/non-negative safe integer/);
  });

  it('redacts unsafe provider details from CLI error output', () => {
    const unsafe = new Error(
      'connect ETIMEDOUT ph-os-prod.abc.ap-northeast-1.rds.amazonaws.com postgresql://user:password@host/db arn:aws:rds:ap-northeast-1:123456789012:db:prod s3://bucket/patients/raw',
    );
    const formatted = JSON.stringify(formatRecoveryIntegrityCliError(unsafe));
    expect(formatted).toContain('backup recovery integrity audit failed');
    expect(formatted).not.toContain('ph-os-prod');
    expect(formatted).not.toContain('postgresql://');
    expect(formatted).not.toContain('password');
    expect(formatted).not.toContain('arn:aws');
    expect(formatted).not.toContain('s3://');
  });

  it('keeps SQL constants read-only', () => {
    const forbidden =
      /\b(UPDATE|DELETE|INSERT|TRUNCATE|ALTER|DROP|CREATE|COPY|LISTEN|NOTIFY|nextval|setval|pg_advisory_lock|dblink|lo_import|set_config)\b|;/i;
    for (const sql of [RECOVERY_INTEGRITY_COUNTS_SQL, RECOVERY_INTEGRITY_CHECKS_SQL]) {
      expect(sql.trim()).toMatch(/^(SELECT|WITH)\b/i);
      expect(sql).not.toMatch(forbidden);
      expect(sql).toContain('COUNT(*)::text');
    }
    expect(RECOVERY_INTEGRITY_CHECKS_SQL).toContain('visit_record_patient_case_mismatch');
    expect(RECOVERY_INTEGRITY_CHECKS_SQL).toContain('care_report_case_patient_mismatch');
    expect(RECOVERY_INTEGRITY_CHECKS_SQL).toContain('care_report_visit_record_patient_mismatch');
    expect(RECOVERY_INTEGRITY_CHECKS_SQL).toContain('task_case_reference_missing');
    expect(RECOVERY_INTEGRITY_CHECKS_SQL).toContain('task_cycle_reference_missing');
    expect(RECOVERY_INTEGRITY_CHECKS_SQL).toContain('task_visit_reference_missing');
  });
});
