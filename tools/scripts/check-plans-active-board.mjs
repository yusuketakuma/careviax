#!/usr/bin/env node
// Plans.md active-board ratchet (PLANS-ACTIVE-LINT-001).
//
// This check keeps the implementation entrypoint narrow: the current active
// backlog is Active Plan Board v8 only. Archived/reference sections may keep
// historical unchecked tasks, but they must not drift into active counts.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const PLANS_PATH = 'Plans.md';
const ACTIVE_HEADING = '### 2026-07-08 Active Plan Board v8';
const ARCHIVE_HEADING = '### 2026-07-08 Archived Plan Board';

const ACTIVE_QUEUE_HEADINGS = [
  'Implementation-ready queue — 未実装 / Partial 残スコープのみ',
  'Frontend implementation queue — 未実装だけ',
];

const COMPLETED_DERIVED_HEADING = '今回完了した派生タスク（再実装しない）';

function fail(message, details = []) {
  console.error('Plans active board check failed.');
  console.error(`- ${message}`);
  for (const detail of details) console.error(`  ${detail}`);
  process.exit(1);
}

function splitLines(content) {
  return content.split(/\r?\n/);
}

function findLineIndex(lines, needle) {
  return lines.findIndex((line) => line.includes(needle));
}

function extractActiveLines(content) {
  const lines = splitLines(content);
  const activeIndex = findLineIndex(lines, ACTIVE_HEADING);
  if (activeIndex === -1) fail(`${ACTIVE_HEADING} is missing`);
  const archiveIndex = findLineIndex(lines, ARCHIVE_HEADING);
  if (archiveIndex === -1) fail(`${ARCHIVE_HEADING} is missing`);
  if (archiveIndex <= activeIndex)
    fail('Archived Plan Board must appear after Active Plan Board v8');
  return lines.slice(activeIndex, archiveIndex);
}

function findBoldHeadingIndex(lines, heading) {
  return lines.findIndex((line) => line.includes(`**${heading}`));
}

function extractTableAfterHeading(lines, heading) {
  const headingIndex = findBoldHeadingIndex(lines, heading);
  if (headingIndex === -1) fail(`section heading is missing: ${heading}`);

  const tableStart = lines.findIndex(
    (line, index) => index > headingIndex && line.trim().startsWith('|'),
  );
  if (tableStart === -1) fail(`markdown table is missing after: ${heading}`);

  const tableLines = [];
  for (let index = tableStart; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('|')) break;
    tableLines.push(line);
  }
  if (tableLines.length < 3) fail(`markdown table has no data rows: ${heading}`);
  return tableLines;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function dataRows(tableLines) {
  return tableLines.slice(2).filter((line) => {
    const cells = splitTableRow(line);
    return cells.some((cell) => cell && !/^-+$/.test(cell));
  });
}

function countRows(lines, heading) {
  return dataRows(extractTableAfterHeading(lines, heading)).length;
}

function readBucketCounts(activeLines) {
  const tableLines = extractTableAfterHeading(activeLines, '現在の分類サマリー');
  const counts = new Map();
  for (const row of dataRows(tableLines)) {
    const [bucket, countText] = splitTableRow(row);
    if (countText === '-') continue;
    const count = Number.parseInt(countText.replace(/[^\d-]/g, ''), 10);
    if (!Number.isSafeInteger(count)) fail(`invalid bucket count for ${bucket}: ${countText}`);
    counts.set(bucket, count);
  }
  return counts;
}

function readFirstCellIds(lines, heading) {
  return dataRows(extractTableAfterHeading(lines, heading))
    .map((row) => splitTableRow(row)[0])
    .map((cell) => cell.replace(/`/g, '').trim())
    .filter(Boolean);
}

function readCompletedDerivedIds(activeLines) {
  const headingIndex = findBoldHeadingIndex(activeLines, COMPLETED_DERIVED_HEADING);
  if (headingIndex === -1) fail(`${COMPLETED_DERIVED_HEADING} is missing`);
  const ids = [];
  for (let index = headingIndex + 1; index < activeLines.length; index += 1) {
    const line = activeLines[index];
    if (line.startsWith('**') || line.startsWith('### ')) break;
    const match = line.match(/^- `([^`]+)`:/);
    if (match) ids.push(match[1]);
  }
  if (ids.length === 0) fail(`${COMPLETED_DERIVED_HEADING} has no completed task IDs`);
  return ids;
}

function assertCount(counts, bucket, actual) {
  const expected = counts.get(bucket);
  if (expected == null) fail(`classification summary is missing bucket: ${bucket}`);
  if (expected !== actual) {
    fail(`${bucket} count mismatch`, [`expected ${expected}`, `actual ${actual}`]);
  }
}

function assertNoCompletedIdsInActiveQueues(activeLines) {
  const completedIds = new Set(readCompletedDerivedIds(activeLines));
  const activeIds = ACTIVE_QUEUE_HEADINGS.flatMap((heading) =>
    readFirstCellIds(activeLines, heading),
  );
  const repeated = activeIds.filter((id) => completedIds.has(id));
  if (repeated.length > 0) {
    fail(
      'completed derived task IDs must not remain in active queues',
      repeated.map((id) => `- ${id}`),
    );
  }
}

function assertNoLegacyActiveDashboardRail(activeLines) {
  const activeText = activeLines.join('\n');
  if (activeText.includes('`DASH-P1-010-RAIL`')) {
    fail(
      'completed Dashboard Summary Rail legacy ID `DASH-P1-010-RAIL` is still present in Active Plan Board v8',
    );
  }
}

function assertArchiveIsReferenceOnly(content) {
  const lines = splitLines(content);
  const archiveIndex = findLineIndex(lines, ARCHIVE_HEADING);
  const archiveLines = lines.slice(archiveIndex, archiveIndex + 8).join('\n');
  if (!archiveLines.includes('active backlog として数えない')) {
    fail('Archived Plan Board must explicitly say it is not counted as active backlog');
  }
}

export function checkPlansActiveBoard(content) {
  const activeLines = extractActiveLines(content);
  const counts = readBucketCounts(activeLines);

  assertCount(
    counts,
    'Done / frozen',
    countRows(activeLines, 'Done / frozen — active backlog から削除するもの'),
  );
  assertCount(
    counts,
    'Partial / residual track',
    countRows(activeLines, 'Partial — 残スコープだけを実装するもの'),
  );
  assertCount(
    counts,
    'Implementation queue',
    countRows(activeLines, 'Implementation-ready queue — 未実装 / Partial 残スコープのみ'),
  );
  assertCount(
    counts,
    'Frontend queue',
    countRows(activeLines, 'Frontend implementation queue — 未実装だけ'),
  );

  assertNoCompletedIdsInActiveQueues(activeLines);
  assertNoLegacyActiveDashboardRail(activeLines);
  assertArchiveIsReferenceOnly(content);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const content = readFileSync(path.join(REPO_ROOT, PLANS_PATH), 'utf8');
  checkPlansActiveBoard(content);
  console.log('Plans active board check passed.');
}
