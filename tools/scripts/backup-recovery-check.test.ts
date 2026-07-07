import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendBackupRecoveryRecord,
  buildBackupRecoveryEvidence,
  buildBackupRecoveryEvidenceNotes,
  buildBackupRecoveryRecordRow,
  parseBackupRecoveryCheckArgs,
} from './backup-recovery-check';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const current = tempDirs.pop();
    if (current) {
      fs.rmSync(current, { recursive: true, force: true });
    }
  }
});

function createDrillDoc() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-recovery-check-'));
  tempDirs.push(cwd);
  const documentPath = path.join(cwd, 'backup-recovery-drill.md');
  fs.writeFileSync(
    documentPath,
    [
      '# backup drill',
      '',
      '| 実施日 | 実施者 | 結果 | 所要時間 | 備考 |',
      '| ---------- | ------ | -------------------- | -------- | ---------------------------------------------------------------------------------------- |',
      '| 未実施 | — | 未実施 | — | 初回試験待ち |',
      '',
    ].join('\n'),
    'utf8',
  );
  return documentPath;
}

describe('backup-recovery-check', () => {
  it('builds structured, table-safe recovery evidence notes', () => {
    const evidence = buildBackupRecoveryEvidence(
      parseBackupRecoveryCheckArgs([
        '--append',
        '--mode',
        'live',
        '--environment',
        'recovery-drill',
        '--result',
        'live drill complete',
        '--operator',
        'ops lead',
        '--duration',
        '120min',
        '--ticket',
        'INC-2026-0708',
        '--approver',
        'security lead',
        '--started-at',
        '2026-07-08T10:00:00+09:00',
        '--completed-at',
        '2026-07-08T12:00:00+09:00',
        '--rto-minutes',
        '120',
        '--rpo-minutes',
        '30',
        '--health-status',
        'passed',
        '--redaction-check',
        'passed',
        '--sample-counts',
        'patients:10,reports:5,audit:20',
        '--notes',
        'RDS / S3 / Cognito verified | no raw identifiers',
      ]),
    );

    expect(buildBackupRecoveryEvidenceNotes(evidence)).toBe(
      '[mode:live; environment=recovery-drill; ticket=INC-2026-0708; approver=security lead; started_at=2026-07-08T01:00:00.000Z; completed_at=2026-07-08T03:00:00.000Z; rto_minutes=120; rpo_minutes=30; health=passed; redaction=passed; samples=patients:10,reports:5,audit:20; summary=RDS / S3 / Cognito verified / no raw identifiers]',
    );
    expect(buildBackupRecoveryRecordRow(evidence, new Date('2026-07-08T12:34:56.000Z'))).toBe(
      '| 2026-07-08 | ops lead | live drill complete | 120min | [mode:live; environment=recovery-drill; ticket=INC-2026-0708; approver=security lead; started_at=2026-07-08T01:00:00.000Z; completed_at=2026-07-08T03:00:00.000Z; rto_minutes=120; rpo_minutes=30; health=passed; redaction=passed; samples=patients:10,reports:5,audit:20; summary=RDS / S3 / Cognito verified / no raw identifiers] |\n',
    );
  });

  it('rejects raw PHI, secrets, and infra identifiers before append', () => {
    for (const unsafeValue of [
      'arn:aws:rds:ap-northeast-1:123456789012:db:ph-os-prod',
      'https://bucket.s3.amazonaws.com/key?X-Amz-Signature=secret',
      'DATABASE_URL=postgres://user:pass@example',
      'sg-0123456789abcdef0',
      'subnet-0123456789abcdef0',
      'vpc-0123456789abcdef0',
      's3://prod-bucket/patient/file.pdf',
      'patients/p123/report.pdf',
      '03-1234-5678',
      '0312345678',
      '患者:山田太郎',
      '患者名 山田太郎',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      'AKIA0123456789ABCDEF',
      'sk-test_0123456789abcdef',
      'DBSnapshotIdentifier=snap-0123456789abcdef0',
      'example.internal',
      '住所:東京都港区1-2-3',
      'AWS_SECRET_ACCESS_KEY=abc123secret',
      'AWS_SESSION_TOKEN=abc123secret',
      'https://bucket.s3.ap-northeast-1.amazonaws.com/patient/report.pdf',
      's3_key=patients/123/report.pdf',
      'patient_id=pt_123',
      '+81-90-1234-5678',
    ]) {
      expect(() =>
        buildBackupRecoveryEvidence(
          parseBackupRecoveryCheckArgs([
            '--append',
            '--mode',
            'live',
            '--environment',
            'recovery-drill',
            '--result',
            'complete',
            '--operator',
            'ops',
            '--duration',
            '120min',
            '--ticket',
            'DRILL-1',
            '--approver',
            'ops-lead',
            '--started-at',
            '2026-07-08T10:00:00+09:00',
            '--completed-at',
            '2026-07-08T12:00:00+09:00',
            '--rto-minutes',
            '120',
            '--rpo-minutes',
            '30',
            '--health-status',
            'passed',
            '--redaction-check',
            'passed',
            '--sample-counts',
            'patients:10',
            '--notes',
            unsafeValue,
          ]),
        ),
      ).toThrow(/復旧証跡へ保存できない値/);
    }
  });

  it('rejects structured delimiter injection before append', () => {
    expect(() =>
      buildBackupRecoveryEvidence(
        parseBackupRecoveryCheckArgs([
          '--append',
          '--mode',
          'tabletop',
          '--result',
          'complete',
          '--operator',
          'ops',
          '--duration',
          '45min',
          '--notes',
          'ok; mode:live; ticket=DRILL-1',
        ]),
      ),
    ).toThrow(/構造化区切り文字/);
  });

  it('replaces the initial placeholder row only after required structured evidence is valid', () => {
    const documentPath = createDrillDoc();
    const evidence = buildBackupRecoveryEvidence(
      parseBackupRecoveryCheckArgs([
        '--append',
        '--mode',
        'tabletop',
        '--result',
        'tabletop complete',
        '--operator',
        'ops',
        '--duration',
        '45min',
        '--notes',
        'required files checked',
      ]),
    );

    appendBackupRecoveryRecord({
      documentPath,
      evidence,
      now: new Date('2026-07-08T00:00:00.000Z'),
    });

    const next = fs.readFileSync(documentPath, 'utf8');
    expect(next).not.toContain('| 未実施 | — | 未実施 | — | 初回試験待ち |');
    expect(next).toContain(
      '| 2026-07-08 | ops | tabletop complete | 45min | [mode:tabletop; summary=required files checked] |',
    );
  });

  it('does not mutate the drill document when required append fields are missing', () => {
    const documentPath = createDrillDoc();
    const before = fs.readFileSync(documentPath, 'utf8');

    expect(() =>
      buildBackupRecoveryEvidence(
        parseBackupRecoveryCheckArgs([
          '--append',
          '--mode',
          'live',
          '--result',
          'complete',
          '--operator',
          'ops',
        ]),
      ),
    ).toThrow(/--result --operator --duration/);

    expect(fs.readFileSync(documentPath, 'utf8')).toBe(before);
  });

  it('fails closed for incomplete live evidence before append', () => {
    const documentPath = createDrillDoc();
    const before = fs.readFileSync(documentPath, 'utf8');

    expect(() =>
      buildBackupRecoveryEvidence(
        parseBackupRecoveryCheckArgs([
          '--append',
          '--mode',
          'live',
          '--result',
          'complete',
          '--operator',
          'ops',
          '--duration',
          '120min',
          '--ticket',
          'DRILL-1',
          '--approver',
          'ops-lead',
          '--rto-minutes',
          '120',
          '--rpo-minutes',
          '30',
          '--health-status',
          'passed',
          '--redaction-check',
          'passed',
          '--sample-counts',
          'patients:10',
        ]),
      ),
    ).toThrow(/--mode live の --append には --environment --started-at --completed-at が必要です/);

    expect(fs.readFileSync(documentPath, 'utf8')).toBe(before);
  });

  it('requires passed health and redaction checks for live evidence', () => {
    for (const [field, value, message] of [
      ['--health-status', 'degraded', /--health-status passed/],
      ['--redaction-check', 'failed', /--redaction-check passed/],
    ] as const) {
      expect(() =>
        buildBackupRecoveryEvidence(
          parseBackupRecoveryCheckArgs([
            '--append',
            '--mode',
            'live',
            '--environment',
            'recovery-drill',
            '--result',
            'complete',
            '--operator',
            'ops',
            '--duration',
            '120min',
            '--ticket',
            'DRILL-1',
            '--approver',
            'ops-lead',
            '--started-at',
            '2026-07-08T10:00:00+09:00',
            '--completed-at',
            '2026-07-08T12:00:00+09:00',
            '--rto-minutes',
            '120',
            '--rpo-minutes',
            '30',
            field,
            value,
            field === '--health-status' ? '--redaction-check' : '--health-status',
            'passed',
            '--sample-counts',
            'patients:10',
          ]),
        ),
      ).toThrow(message);
    }
  });
});
