#!/usr/bin/env node
// Plans.md active-board ratchet (PLANS-ACTIVE-LINT-001).
//
// This check keeps Plans.md limited to the current unfinished board.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const PLANS_PATH = 'Plans.md';
const COMPLETED_ARCHIVE_PATH = 'docs/plans-archive.md';
const API_RESPONSE_ALLOWLIST_PATH = 'tools/api-response-shape-allowlist.json';
const ACTIVE_HEADING = '### 2026-07-09 Active Plan Board v9';

const ACTIVE_QUEUE_HEADINGS = [
  'Implementation-ready queue — 未実装 / Partial 残スコープのみ',
  'Frontend implementation queue — 未実装だけ',
];

const FHIR_PARENT_ROLLUP_IDS = new Set([
  'FHIR-NATIVE-P0-FOUNDATION-001',
  'FHIR-NATIVE-PHOS-SERVER-001',
  'FHIR-NATIVE-CONFORMANCE-001',
  'FHIR-NATIVE-ADAPTER-PLANE-001',
  'FHIR-NATIVE-YRESE-SYNC-001',
  'FHIR-NATIVE-LEGACY-MIGRATION-001',
  'FHIR-NATIVE-CUTOVER-001',
  'FHIR-NATIVE-UI-DOGFOOD-001',
  'FHIR-NATIVE-OFFLINE-EDGE-001',
  'FHIR-NATIVE-OPEN-ECOSYSTEM-001',
]);

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
  return lines.slice(activeIndex);
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

function taskRows(lines, heading, idIndex = 0, statusIndex = 1) {
  return dataRows(extractTableAfterHeading(lines, heading)).map((row) => {
    const cells = splitTableRow(row);
    const id = cells[idIndex]?.match(/`([^`]+)`/)?.[1];
    const status = cells[statusIndex]?.trim();
    if (!id || !status) fail(`invalid task row in ${heading}`, [row]);
    return { id, status };
  });
}

function readNamedCounts(lines, heading) {
  const counts = new Map();
  for (const row of dataRows(extractTableAfterHeading(lines, heading))) {
    const [name, countText] = splitTableRow(row);
    const count = Number.parseInt(countText.replace(/[^\d-]/g, ''), 10);
    if (Number.isSafeInteger(count)) counts.set(name, count);
  }
  return counts;
}

function countTaskBullets(lines, heading) {
  const headingIndex = findBoldHeadingIndex(lines, heading);
  if (headingIndex === -1) fail(`section heading is missing: ${heading}`);
  let count = 0;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith('**')) break;
    if (/^- `[^`]+`/.test(line)) count += 1;
  }
  return count;
}

function countListBullets(lines, heading) {
  const headingIndex = findBoldHeadingIndex(lines, heading);
  if (headingIndex === -1) fail(`section heading is missing: ${heading}`);
  let count = 0;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith('**')) break;
    if (line.startsWith('- ')) count += 1;
  }
  return count;
}

function extractSectionLines(lines, heading) {
  const headingIndex = findBoldHeadingIndex(lines, heading);
  if (headingIndex === -1) fail(`section heading is missing: ${heading}`);
  const sectionLines = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith('**')) break;
    sectionLines.push(line);
  }
  return sectionLines;
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

function assertDispatchIntegrity(activeLines, bucketCounts, dispatchCounts) {
  const implementation = taskRows(
    activeLines,
    'Implementation-ready queue — 未実装 / Partial 残スコープのみ',
  );
  const fhirChildren = taskRows(
    activeLines,
    'FHIR Native child execution registry — PR-sized active tasks（2026-07-15）',
    1,
    2,
  );
  const frontend = taskRows(activeLines, 'Frontend implementation queue — 未実装だけ');

  const queueOccurrences = new Map();
  for (const [queue, tasks] of [
    ['Implementation', implementation],
    ['FHIR child', fhirChildren],
    ['Frontend', frontend],
  ]) {
    for (const { id } of tasks) {
      const queues = queueOccurrences.get(id) ?? [];
      queues.push(queue);
      queueOccurrences.set(id, queues);
    }
  }
  const duplicateQueueIds = [...queueOccurrences]
    .filter(([, queues]) => queues.length > 1)
    .map(([id, queues]) => `${id}: ${queues.join(', ')}`);
  if (duplicateQueueIds.length > 0) {
    fail('task IDs must be unique within and across all direct queues', duplicateQueueIds);
  }

  const implementationFhirIds = implementation
    .map(({ id }) => id)
    .filter((id) => id.startsWith('FHIR-NATIVE-'));
  const unknownImplementationFhirIds = implementationFhirIds.filter(
    (id) => !FHIR_PARENT_ROLLUP_IDS.has(id),
  );
  if (unknownImplementationFhirIds.length > 0) {
    fail('Implementation queue may contain only exact FHIR parent roll-up IDs', [
      ...unknownImplementationFhirIds,
    ]);
  }

  const parentIdsInChildQueue = fhirChildren
    .map(({ id }) => id)
    .filter((id) => FHIR_PARENT_ROLLUP_IDS.has(id));
  if (parentIdsInChildQueue.length > 0) {
    fail(
      'FHIR parent roll-up IDs must not appear in the FHIR child registry',
      parentIdsInChildQueue,
    );
  }

  const nonFhirImplementation = implementation.filter(({ id }) => !FHIR_PARENT_ROLLUP_IDS.has(id));
  const directTasks = [...nonFhirImplementation, ...fhirChildren, ...frontend];
  const statusCounts = new Map();
  for (const { id, status } of directTasks) {
    if (
      !['In progress', 'Validating', 'Partial', 'Not started', 'Human gate', 'Blocked'].includes(
        status,
      )
    ) {
      fail('direct claimable task has unsupported status', [`${id}: ${status}`]);
    }
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const countStatus = (status) => statusCounts.get(status) ?? 0;
  const readyCount =
    countStatus('In progress') +
    countStatus('Validating') +
    countStatus('Partial') +
    countStatus('Not started');
  const humanCount = countStatus('Human gate');
  const blockedCount = countStatus('Blocked');
  const residualCount = countRows(activeLines, 'Partial — 残スコープだけを実装するもの');
  const investigationCount = countTaskBullets(
    activeLines,
    'Current unresolved / verification tasks',
  );
  const programCount = countRows(activeLines, 'Program backlog —');
  const externalCount = countListBullets(activeLines, 'External prerequisites —');

  assertCount(bucketCounts, 'FHIR child queue', fhirChildren.length);
  assertCount(dispatchCounts, 'Continue / ready to cut', readyCount);
  assertCount(dispatchCounts, 'Human approval required', humanCount);
  assertCount(dispatchCounts, 'Dependency blocked', blockedCount);
  assertCount(dispatchCounts, 'Residual track', residualCount);
  assertCount(dispatchCounts, 'Investigation / verify', investigationCount);
  assertCount(dispatchCounts, 'Long-term / external', programCount + externalCount);

  const expectedDirect = directTasks.length;
  const directLine = activeLines.find((line) => line.includes('直接claim可能な正本queueは'));
  const declaredDirect = directLine?.match(/= \*\*(\d+)件\*\*/)?.[1];
  if (Number.parseInt(declaredDirect ?? '', 10) !== expectedDirect) {
    fail('direct claimable task total mismatch', [
      `expected ${expectedDirect}`,
      `actual ${declaredDirect ?? 'missing'}`,
    ]);
  }

  const dispatchRows = new Map(
    dataRows(extractTableAfterHeading(activeLines, '実装ディスパッチボード')).map((row) => {
      const [name, , breakdown] = splitTableRow(row);
      return [name, breakdown.replace(/\s+/g, ' ').trim()];
    }),
  );
  const expectedBreakdowns = new Map([
    [
      'Continue / ready to cut',
      `In progress ${countStatus('In progress')} / Validating ${countStatus('Validating')} / Partial ${countStatus('Partial')} / Not started ${countStatus('Not started')}`,
    ],
    ['Human approval required', `Human gate ${humanCount}`],
    ['Dependency blocked', `Blocked ${blockedCount}`],
    ['Residual track', `Partial track ${residualCount}`],
    ['Investigation / verify', `Unresolved / verification ${investigationCount}`],
    ['Long-term / external', `Program ${programCount} / External prerequisite ${externalCount}`],
  ]);
  for (const [name, expected] of expectedBreakdowns) {
    const actual = dispatchRows.get(name);
    if (actual !== expected) {
      fail(`${name} status breakdown mismatch`, [
        `expected ${expected}`,
        `actual ${actual ?? 'missing'}`,
      ]);
    }
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

  const completedResidualRows = dataRows(
    extractTableAfterHeading(activeLines, 'Partial — 残スコープだけを実装するもの'),
  ).filter((row) =>
    splitTableRow(row).some((cell) => /^(?:\*\*)?(?:done|completed)(?:\b|\*\*)/i.test(cell)),
  );
  if (completedResidualRows.length > 0) {
    fail('completed residual rows must not remain in Plans.md', completedResidualRows);
  }

  const hasCompletedMarker = (value) =>
    /(?:^|[:|])\s*(?:\*\*)?(?:done|completed|完了済み|完了)(?:\b|\*\*|[（(])/i.test(value.trim());
  const completedProgramRows = dataRows(
    extractTableAfterHeading(activeLines, 'Program backlog —'),
  ).filter((row) => splitTableRow(row).some(hasCompletedMarker));
  if (completedProgramRows.length > 0) {
    fail('completed program rows must not remain in Plans.md', completedProgramRows);
  }

  const externalLines = extractSectionLines(activeLines, 'External prerequisites —');
  const completedExternalBullets = externalLines.filter(
    (line) => /^\s*-\s+/.test(line) && hasCompletedMarker(line.replace(/^\s*-\s+/, '')),
  );
  if (completedExternalBullets.length > 0) {
    fail('completed external prerequisites must not remain in Plans.md', completedExternalBullets);
  }
}

function readActiveQueueIds(activeLines) {
  return new Set([
    ...ACTIVE_QUEUE_HEADINGS.flatMap((heading) =>
      dataRows(extractTableAfterHeading(activeLines, heading)).flatMap((row) => {
        const [idCell] = splitTableRow(row);
        const match = idCell?.match(/`([^`]+)`/);
        return match ? [match[1]] : [];
      }),
    ),
    ...taskRows(
      activeLines,
      'FHIR Native child execution registry — PR-sized active tasks（2026-07-15）',
      1,
      2,
    ).map(({ id }) => id),
  ]);
}

function assertNoArchivedIdsInActiveQueues(activeLines, completedArchiveContent) {
  const activeIds = readActiveQueueIds(activeLines);
  const archivedIds = new Set(
    [...completedArchiveContent.matchAll(/^\s*- \[x\] `([^`]+)`/gm)].map((match) => match[1]),
  );
  const overlap = [...activeIds].filter((id) => archivedIds.has(id)).sort();

  if (overlap.length > 0) {
    fail(
      'completed archive IDs must not remain in active implementation queues',
      overlap.map((id) => `- ${id}`),
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

export function checkPlansActiveBoard(content, completedArchiveContent = '') {
  const activeLines = extractActiveLines(content);
  const counts = readBucketCounts(activeLines);
  const dispatchCounts = readNamedCounts(activeLines, '実装ディスパッチボード');

  assertNoCompletedHistorySections(activeLines, counts);
  assertNoCompletedTaskEntries(activeLines);
  assertCount(
    counts,
    'Partial / residual track',
    countRows(activeLines, 'Partial — 残スコープだけを実装するもの'),
  );
  assertCount(
    dispatchCounts,
    'Investigation / verify',
    countTaskBullets(activeLines, 'Current unresolved / verification tasks'),
  );
  assertCount(
    dispatchCounts,
    'Long-term / external',
    countRows(activeLines, 'Program backlog —') +
      countListBullets(activeLines, 'External prerequisites —'),
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
  assertNoArchivedIdsInActiveQueues(activeLines, completedArchiveContent);
  assertNoLegacyActiveDashboardRail(activeLines);
  assertNoStaleBoardVersion(activeLines);
  assertApiResponseDebtMatchesAllowlist(activeLines);
  assertDispatchIntegrity(activeLines, counts, dispatchCounts);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const content = readFileSync(path.join(REPO_ROOT, PLANS_PATH), 'utf8');
  const completedArchiveContent = readFileSync(
    path.join(REPO_ROOT, COMPLETED_ARCHIVE_PATH),
    'utf8',
  );
  checkPlansActiveBoard(content, completedArchiveContent);
  console.log('Plans active board check passed.');
}
