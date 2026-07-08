import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getBackupDrillSummary } from '@/lib/operations/external-readiness';
import { assertSafeRecoveryEvidenceValue } from '@/lib/operations/recovery-evidence';
import { formatUtcDateKey } from '@/lib/date-key';
import { parseOptionalStringArg } from './_shared/report-cli';

const ROOT = process.cwd();
const DRILL_DOC = path.join(ROOT, 'docs/compliance/backup-recovery-drill.md');
const STRUCTURED_EVIDENCE_DELIMITER_PATTERN = /[;；[\]［］]/;

type BackupRecoveryCheckArgs = {
  append: boolean;
  mode: 'live' | 'tabletop';
  environment?: string;
  result?: string;
  operator?: string;
  duration?: string;
  notes: string;
  ticket?: string;
  approver?: string;
  startedAt?: string;
  completedAt?: string;
  rtoMinutes?: string;
  rpoMinutes?: string;
  healthStatus?: string;
  redactionCheck?: string;
  sampleCounts?: string;
};

type BackupRecoveryEvidence = {
  mode: 'live' | 'tabletop';
  environment?: string;
  result: string;
  operator: string;
  duration: string;
  notes: string;
  ticket?: string;
  approver?: string;
  startedAt?: string;
  completedAt?: string;
  rtoMinutes?: string;
  rpoMinutes?: string;
  healthStatus?: string;
  redactionCheck?: string;
  sampleCounts?: string;
};

export function parseBackupRecoveryCheckArgs(argv: string[]): BackupRecoveryCheckArgs {
  const append = argv.includes('--append');
  const mode = parseOptionalStringArg(argv, '--mode') ?? 'tabletop';
  if (mode !== 'live' && mode !== 'tabletop') {
    throw new Error('--mode は live か tabletop を指定してください');
  }
  const result = parseOptionalStringArg(argv, '--result');
  const operator = parseOptionalStringArg(argv, '--operator');
  const duration = parseOptionalStringArg(argv, '--duration');
  const notes = parseOptionalStringArg(argv, '--notes') ?? '';
  return {
    append,
    mode,
    environment: parseOptionalStringArg(argv, '--environment') ?? undefined,
    result: result ?? undefined,
    operator: operator ?? undefined,
    duration: duration ?? undefined,
    notes,
    ticket: parseOptionalStringArg(argv, '--ticket') ?? undefined,
    approver: parseOptionalStringArg(argv, '--approver') ?? undefined,
    startedAt: parseOptionalStringArg(argv, '--started-at') ?? undefined,
    completedAt: parseOptionalStringArg(argv, '--completed-at') ?? undefined,
    rtoMinutes: parseOptionalStringArg(argv, '--rto-minutes') ?? undefined,
    rpoMinutes: parseOptionalStringArg(argv, '--rpo-minutes') ?? undefined,
    healthStatus: parseOptionalStringArg(argv, '--health-status') ?? undefined,
    redactionCheck: parseOptionalStringArg(argv, '--redaction-check') ?? undefined,
    sampleCounts: parseOptionalStringArg(argv, '--sample-counts') ?? undefined,
  };
}

function normalizeEvidenceText(value: string, field: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  assertSafeRecoveryEvidenceValue(normalized, field);
  if (STRUCTURED_EVIDENCE_DELIMITER_PATTERN.test(normalized)) {
    throw new Error(`${field} に復旧証跡の構造化区切り文字は使用できません`);
  }
  return normalized.replaceAll('|', '/').slice(0, 180);
}

function normalizeOptionalEvidenceText(value: string | undefined, field: string) {
  if (!value) return undefined;
  return normalizeEvidenceText(value, field);
}

function normalizeEvidenceEnum<T extends readonly string[]>(
  value: string | undefined,
  field: string,
  allowedValues: T,
) {
  if (!value) return undefined;
  const normalized = normalizeEvidenceText(value, field).toLowerCase();
  if (!allowedValues.includes(normalized)) {
    throw new Error(`${field} は ${allowedValues.join(', ')} のいずれかを指定してください`);
  }
  return normalized as T[number];
}

function formatDurationMinutes(value: string | undefined, field: string) {
  if (!value) return undefined;
  const normalized = normalizeEvidenceText(value, field);
  if (!/^\d{1,5}$/.test(normalized)) {
    throw new Error(`${field} は分単位の数値で指定してください`);
  }
  return normalized;
}

function normalizeIsoDateTime(value: string | undefined, field: string) {
  if (!value) return undefined;
  const normalized = normalizeEvidenceText(value, field);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} は ISO 8601 形式の日時で指定してください`);
  }
  return parsed.toISOString();
}

function normalizeSampleCounts(value: string | undefined) {
  if (!value) return undefined;
  const normalized = normalizeEvidenceText(value, 'sample-counts');
  if (!/^[a-z][a-z0-9_]*:\d{1,6}(,[a-z][a-z0-9_]*:\d{1,6})*$/.test(normalized)) {
    throw new Error(
      'sample-counts は patients:10,reports:5 のような key:number CSV で指定してください',
    );
  }
  return normalized;
}

function assertLiveEvidenceComplete(evidence: BackupRecoveryEvidence) {
  if (evidence.mode !== 'live') return;
  const missing = [
    ['environment', evidence.environment],
    ['ticket', evidence.ticket],
    ['approver', evidence.approver],
    ['started-at', evidence.startedAt],
    ['completed-at', evidence.completedAt],
    ['rto-minutes', evidence.rtoMinutes],
    ['rpo-minutes', evidence.rpoMinutes],
    ['health-status', evidence.healthStatus],
    ['redaction-check', evidence.redactionCheck],
    ['sample-counts', evidence.sampleCounts],
  ]
    .filter(([, value]) => !value)
    .map(([field]) => `--${field}`);
  if (missing.length > 0) {
    throw new Error(`--mode live の --append には ${missing.join(' ')} が必要です`);
  }
  if (evidence.healthStatus !== 'passed') {
    throw new Error('--mode live の証跡には --health-status passed が必要です');
  }
  if (evidence.redactionCheck !== 'passed') {
    throw new Error('--mode live の証跡には --redaction-check passed が必要です');
  }
}

export function buildBackupRecoveryEvidence(args: BackupRecoveryCheckArgs): BackupRecoveryEvidence {
  if (!args.result || !args.operator || !args.duration) {
    throw new Error('--append 時は --result --operator --duration が必要です');
  }

  const evidence: BackupRecoveryEvidence = {
    mode: args.mode,
    environment: normalizeEvidenceEnum(args.environment, 'environment', [
      'local',
      'staging',
      'production',
      'production-like',
      'recovery-drill',
    ] as const),
    result: normalizeEvidenceText(args.result, 'result'),
    operator: normalizeEvidenceText(args.operator, 'operator'),
    duration: normalizeEvidenceText(args.duration, 'duration'),
    notes: normalizeOptionalEvidenceText(args.notes, 'notes') ?? '',
    ticket: normalizeOptionalEvidenceText(args.ticket, 'ticket'),
    approver: normalizeOptionalEvidenceText(args.approver, 'approver'),
    startedAt: normalizeIsoDateTime(args.startedAt, 'started-at'),
    completedAt: normalizeIsoDateTime(args.completedAt, 'completed-at'),
    rtoMinutes: formatDurationMinutes(args.rtoMinutes, 'rto-minutes'),
    rpoMinutes: formatDurationMinutes(args.rpoMinutes, 'rpo-minutes'),
    healthStatus: normalizeEvidenceEnum(args.healthStatus, 'health-status', [
      'passed',
      'failed',
      'degraded',
      'blocked',
    ] as const),
    redactionCheck: normalizeEvidenceEnum(args.redactionCheck, 'redaction-check', [
      'passed',
      'failed',
    ] as const),
    sampleCounts: normalizeSampleCounts(args.sampleCounts),
  };
  assertLiveEvidenceComplete(evidence);
  return evidence;
}

export function buildBackupRecoveryEvidenceNotes(evidence: BackupRecoveryEvidence) {
  const structuredParts = [
    `mode:${evidence.mode}`,
    evidence.environment ? `environment=${evidence.environment}` : null,
    evidence.ticket ? `ticket=${evidence.ticket}` : null,
    evidence.approver ? `approver=${evidence.approver}` : null,
    evidence.startedAt ? `started_at=${evidence.startedAt}` : null,
    evidence.completedAt ? `completed_at=${evidence.completedAt}` : null,
    evidence.rtoMinutes ? `rto_minutes=${evidence.rtoMinutes}` : null,
    evidence.rpoMinutes ? `rpo_minutes=${evidence.rpoMinutes}` : null,
    evidence.healthStatus ? `health=${evidence.healthStatus}` : null,
    evidence.redactionCheck ? `redaction=${evidence.redactionCheck}` : null,
    evidence.sampleCounts ? `samples=${evidence.sampleCounts}` : null,
    evidence.notes ? `summary=${evidence.notes}` : null,
  ].filter(Boolean);

  return `[${structuredParts.join('; ')}]`;
}

export function buildBackupRecoveryRecordRow(evidence: BackupRecoveryEvidence, now = new Date()) {
  const notes = buildBackupRecoveryEvidenceNotes(evidence);
  return `| ${formatUtcDateKey(now)} | ${evidence.operator} | ${evidence.result} | ${evidence.duration} | ${notes} |\n`;
}

export function appendBackupRecoveryRecord(args: {
  documentPath?: string;
  evidence: BackupRecoveryEvidence;
  now?: Date;
}) {
  const documentPath = args.documentPath ?? DRILL_DOC;
  const row = buildBackupRecoveryRecordRow(args.evidence, args.now);
  const current = fs.readFileSync(documentPath, 'utf8');
  const initialRecordRow = '| 未実施 | — | 未実施 | — | 初回試験待ち |';
  const next = current.includes(initialRecordRow)
    ? current.replace(`${initialRecordRow}\n`, row)
    : `${current}${row}`;
  fs.writeFileSync(documentPath, next, 'utf8');
}

export function runBackupRecoveryCheckCli(argv = process.argv.slice(2)) {
  const args = parseBackupRecoveryCheckArgs(argv);
  const summary = getBackupDrillSummary();

  console.log(JSON.stringify(summary, null, 2));

  if (args.append) {
    appendBackupRecoveryRecord({
      evidence: buildBackupRecoveryEvidence(args),
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runBackupRecoveryCheckCli();
}
