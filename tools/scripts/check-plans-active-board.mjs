#!/usr/bin/env node
// Plans.md active-board ratchet (PLANS-ACTIVE-LINT-001).
//
// This check keeps the implementation entrypoint narrow: the current active
// backlog is Active Plan Board v9 only. Archived/reference sections may keep
// historical unchecked tasks, but they must not drift into active counts.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const PLANS_PATH = 'Plans.md';
const API_RESPONSE_ALLOWLIST_PATH = 'tools/api-response-shape-allowlist.json';
const ACTIVE_HEADING = '### 2026-07-09 Active Plan Board v9';
const ARCHIVE_HEADING = '### 2026-07-09 Archived Plan Board';

const ACTIVE_QUEUE_HEADINGS = [
  'Implementation-ready queue — 未実装 / Partial 残スコープのみ',
  'Frontend implementation queue — 未実装だけ',
];

const LEGACY_COMPLETED_SECTION_MARKERS = ['**Done / frozen', '**今回完了した派生タスク'];

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
    fail('Archived Plan Board must appear after Active Plan Board v9');
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

function readApiResponseAllowlistDebt() {
  const allowlistPath = path.join(REPO_ROOT, API_RESPONSE_ALLOWLIST_PATH);
  let raw;
  try {
    raw = readFileSync(allowlistPath, 'utf8');
  } catch (error) {
    fail(`${API_RESPONSE_ALLOWLIST_PATH} is missing or unreadable`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`${API_RESPONSE_ALLOWLIST_PATH} is not valid JSON`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  if (!Array.isArray(parsed.entries)) {
    fail(`${API_RESPONSE_ALLOWLIST_PATH} must contain an entries array`);
  }

  return parsed.entries.reduce((total, entry, index) => {
    const count = entry?.expectedCount;
    if (!Number.isSafeInteger(count) || count < 0) {
      fail(`${API_RESPONSE_ALLOWLIST_PATH} has invalid expectedCount`, [
        `entries[${index}].expectedCount=${String(count)}`,
      ]);
    }
    return total + count;
  }, 0);
}

function assertCount(counts, bucket, actual) {
  const expected = counts.get(bucket);
  if (expected == null) fail(`classification summary is missing bucket: ${bucket}`);
  if (expected !== actual) {
    fail(`${bucket} count mismatch`, [`expected ${expected}`, `actual ${actual}`]);
  }
}

function assertNoCompletedStatusesInActiveQueues(activeLines) {
  const completedRows = ACTIVE_QUEUE_HEADINGS.flatMap((heading) =>
    dataRows(extractTableAfterHeading(activeLines, heading)).flatMap((row) => {
      const [idCell, statusCell] = splitTableRow(row);
      const status = statusCell?.trim() ?? '';
      return /^(?:done|completed)(?:\b|\s*\/)/i.test(status)
        ? [{ heading, id: idCell.replace(/`/g, '').trim(), status }]
        : [];
    }),
  );

  if (completedRows.length > 0) {
    fail(
      'completed statuses must not remain in active implementation queues',
      completedRows.map(({ heading, id, status }) => `- ${heading}: ${id} (${status})`),
    );
  }
}

function assertNoCompletedHistorySections(activeLines, counts) {
  if (counts.has('Done / frozen')) {
    fail('unfinished-only Plans board must not include a Done / frozen summary bucket');
  }

  const completedSections = activeLines
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) =>
      LEGACY_COMPLETED_SECTION_MARKERS.some((marker) => line.startsWith(marker)),
    );
  if (completedSections.length > 0) {
    fail(
      'unfinished-only Plans board must not include completed-history sections',
      completedSections.map(({ line, number }) => `active line ${number}: ${line}`),
    );
  }
}

function assertNoCompletedTaskEntries(activeLines) {
  const completedTasks = activeLines
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => /^-\s+`[^`]+`:\s+\*\*(?:done|completed)(?:\b|\s*\/)/i.test(line));

  if (completedTasks.length > 0) {
    fail(
      'unfinished-only Plans board must not include completed task entries',
      completedTasks.map(({ line, number }) => `active line ${number}: ${line}`),
    );
  }
}

function assertNoLegacyActiveDashboardRail(activeLines) {
  const activeText = activeLines.join('\n');
  if (activeText.includes('`DASH-P1-010-RAIL`')) {
    fail(
      'completed Dashboard Summary Rail legacy ID `DASH-P1-010-RAIL` is still present in Active Plan Board v9',
    );
  }
  if (activeText.includes('`DASH-P1-005-SPLIT-001`')) {
    fail(
      'completed Dashboard link split legacy ID `DASH-P1-005-SPLIT-001` is still present in Active Plan Board v9',
    );
  }
}

function assertNoStaleBoardVersion(activeLines) {
  const staleLines = activeLines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.includes('Active Plan Board v8'));
  if (staleLines.length > 0) {
    fail(
      'Active Plan Board v9 must not describe its active entrypoint as v8',
      staleLines.map(({ line, number }) => `active line ${number}: ${line.trim()}`),
    );
  }
}

function assertApiResponseDebtMatchesAllowlist(activeLines) {
  const expectedDebt = readApiResponseAllowlistDebt();
  const debtLine = activeLines.find(
    (line) => line.includes('api-response-shape') && line.includes('allowlist debt'),
  );
  if (!debtLine) {
    fail('Active Plan Board v9 must record api-response-shape allowlist debt');
  }

  const boldNumber = debtLine.match(/\*\*(\d+)\*\*/);
  const actualDebt = boldNumber ? Number.parseInt(boldNumber[1], 10) : NaN;
  if (actualDebt !== expectedDebt) {
    fail('api-response-shape allowlist debt in Plans.md is stale', [
      `expected ${expectedDebt} from ${API_RESPONSE_ALLOWLIST_PATH}`,
      `actual ${Number.isNaN(actualDebt) ? 'missing bold number' : actualDebt} in Plans.md`,
    ]);
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

  assertNoCompletedHistorySections(activeLines, counts);
  assertNoCompletedTaskEntries(activeLines);
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

  assertNoCompletedStatusesInActiveQueues(activeLines);
  assertNoLegacyActiveDashboardRail(activeLines);
  assertNoStaleBoardVersion(activeLines);
  assertApiResponseDebtMatchesAllowlist(activeLines);
  assertArchiveIsReferenceOnly(content);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const content = readFileSync(path.join(REPO_ROOT, PLANS_PATH), 'utf8');
  checkPlansActiveBoard(content);
  console.log('Plans active board check passed.');
}
