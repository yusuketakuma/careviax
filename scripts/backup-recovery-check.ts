import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { getBackupDrillSummary } from '@/lib/operations/external-readiness';
import { parseOptionalStringArg } from './_shared/report-cli';

const ROOT = process.cwd();
const DRILL_DOC = path.join(ROOT, 'docs/compliance/backup-recovery-drill.md');

function parseArgs(argv: string[]) {
  const append = argv.includes('--append');
  const mode = parseOptionalStringArg(argv, '--mode') ?? 'tabletop';
  if (mode !== 'live' && mode !== 'tabletop') {
    throw new Error('--mode は live か tabletop を指定してください');
  }
  const result = parseOptionalStringArg(argv, '--result');
  const operator = parseOptionalStringArg(argv, '--operator');
  const duration = parseOptionalStringArg(argv, '--duration');
  const notes = parseOptionalStringArg(argv, '--notes') ?? '';
  return { append, mode, result, operator, duration, notes };
}

function appendRecord(args: {
  mode: string;
  result: string;
  operator: string;
  duration: string;
  notes: string;
}) {
  const normalizedNotes = args.notes
    ? `[mode:${args.mode}] ${args.notes}`
    : `[mode:${args.mode}] -`;
  const row = `| ${new Date().toISOString().slice(0, 10)} | ${args.operator} | ${args.result} | ${args.duration} | ${normalizedNotes} |\n`;
  const current = fs.readFileSync(DRILL_DOC, 'utf8');
  const initialRecordRow = '| 未実施 | — | 未実施 | — | 初回試験待ち |';
  const next = current.includes(initialRecordRow) ? current.replace(`${initialRecordRow}\n`, row) : `${current}${row}`;
  fs.writeFileSync(DRILL_DOC, next, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = getBackupDrillSummary();

  console.log(JSON.stringify(summary, null, 2));

  if (args.append) {
    if (!args.result || !args.operator || !args.duration) {
      throw new Error('--append 時は --result --operator --duration が必要です');
    }
    appendRecord({
      mode: args.mode,
      result: args.result,
      operator: args.operator,
      duration: args.duration,
      notes: args.notes,
    });
  }
}

main();
