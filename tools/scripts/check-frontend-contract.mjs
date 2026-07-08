#!/usr/bin/env node
// FRONTEND-CONTRACT-001 ratchet.
//
// The contract is intentionally docs-first, but it must stay complete enough to
// gate later screen slices. This check verifies the required screen IDs,
// current entrypoints, state matrix vocabulary, and high-risk stop boundaries.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const CONTRACT_PATH = 'docs/frontend-screen-contracts.md';

const REQUIRED_TOKENS = [
  'FRONTEND-CONTRACT-001',
  'FE-PATIENT-LIST-001',
  'FE-PATIENT-DETAIL-001',
  'FE-DISPENSE-001',
  'FE-SCHEDULE-001',
  'FE-VISIT-001',
  'FE-REPORT-001',
  'FE-INBOUND-001',
  'FE-QA-001',
  'Compatibility target: none',
  'new-only release contract',
  'server-enforced',
  'server-authorized DTOs',
  'role-specific capability',
  'src/components/layout/app-shell.tsx',
  'src/app/(dashboard)/patients/page.tsx',
  'src/app/(dashboard)/patients/[id]/page.tsx',
  'src/components/features/dispense-workbench/dispensing-workbench.tsx',
  'src/app/(dashboard)/schedules/page.tsx',
  'src/app/(dashboard)/visits/[id]/record/page.tsx',
  'src/app/(dashboard)/reports/page.tsx',
  'src/app/(dashboard)/communications/inbound/page.tsx',
  'GET /api/patients/board',
  'GET /api/patients/:id/movement-timeline',
  '/api/dispense-workbench/patients',
  'GET /api/visit-schedules/day-board',
  '/api/visit-records',
  'GET /api/care-reports/today-workspace',
  'GET/POST /api/communications/inbound',
  'loading, empty, data, partial, error, forbidden, stale, offline, conflict',
  'State Matrix',
  'PHI And Output Boundaries',
  'Client-hidden address/search-index payloads',
  'Sample/mock data may be visible only in dev/test/demo fixtures',
  'Oracle/GPT prompts',
  'explicit user action, scope, recipient/purpose',
  'fail closed',
  '404/410/403',
  'no PHI payload and no write side effect',
  'Stop Conditions',
  'Do not restore legacy movement',
  'Do not add compatibility shims',
  'Do not show mock completion',
  'pnpm frontend-contract:check',
  'pnpm plans:active:check',
];

function fail(message, details = []) {
  console.error('Frontend contract check failed.');
  console.error(`- ${message}`);
  for (const detail of details) console.error(`  ${detail}`);
  process.exit(1);
}

function readContract() {
  try {
    return readFileSync(path.join(REPO_ROOT, CONTRACT_PATH), 'utf8');
  } catch (error) {
    fail(`missing ${CONTRACT_PATH}`, [String(error)]);
  }
}

function assertTokenPresence(content) {
  const normalizedContent = content.replace(/\s+/g, ' ');
  const missing = REQUIRED_TOKENS.filter((token) => {
    const normalizedToken = token.replace(/\s+/g, ' ');
    return !content.includes(token) && !normalizedContent.includes(normalizedToken);
  });
  if (missing.length > 0) fail('required contract tokens are missing', missing);
}

function assertCoveredScreenRowCount(content) {
  const screenRows = content
    .split(/\r?\n/)
    .filter((line) => /^\|\s+`FE-[A-Z-]+-001`\s+\|/.test(line));
  if (screenRows.length !== 7) {
    fail('screen entry point map must contain exactly seven operational FE screen rows', [
      `actual rows: ${screenRows.length}`,
      ...screenRows,
    ]);
  }
}

function assertStateMatrixCoverage(content) {
  const matrixStart = content.indexOf('## State Matrix');
  const boundaryStart = content.indexOf('## PHI And Output Boundaries');
  if (matrixStart === -1 || boundaryStart === -1 || boundaryStart <= matrixStart) {
    fail('State Matrix section must appear before PHI boundary section');
  }
  const matrix = content.slice(matrixStart, boundaryStart);
  const requiredScreens = [
    '患者一覧',
    '患者詳細',
    '調剤',
    'スケジュール',
    '訪問中',
    '報告書',
    '他職種受信',
  ];
  const matrixRows = matrix.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
  const missingScreens = requiredScreens.filter(
    (screen) => !matrixRows.some((line) => line.includes(screen)),
  );
  if (missingScreens.length > 0) fail('State Matrix is missing screen rows', missingScreens);
  for (const state of [
    'Loading',
    'Empty',
    'Data',
    'Partial / stale',
    'Error / forbidden',
    'Offline / conflict',
  ]) {
    if (!matrix.includes(state)) fail(`State Matrix is missing column: ${state}`);
  }
}

function assertPhiBoundaryCoverage(content) {
  const boundaryStart = content.indexOf('## PHI And Output Boundaries');
  const validationStart = content.indexOf('## Exact-Path Validation List');
  if (boundaryStart === -1 || validationStart === -1 || validationStart <= boundaryStart) {
    fail('PHI boundary section must appear before validation section');
  }
  const boundary = content.slice(boundaryStart, validationStart);
  const requiredScreens = [
    '患者一覧',
    '患者詳細',
    '調剤',
    'スケジュール',
    '訪問中',
    '報告書',
    '他職種受信',
  ];
  const boundaryRows = boundary.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
  const missingScreens = requiredScreens.filter(
    (screen) => !boundaryRows.some((line) => line.includes(screen)),
  );
  if (missingScreens.length > 0) fail('PHI boundary table is missing screen rows', missingScreens);
}

export function checkFrontendContract(content) {
  assertTokenPresence(content);
  assertCoveredScreenRowCount(content);
  assertStateMatrixCoverage(content);
  assertPhiBoundaryCoverage(content);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkFrontendContract(readContract());
  console.log('Frontend contract check passed.');
}
