import path from 'node:path';
import os from 'node:os';

const ARTIFACT_ROOT =
  process.env.PLAYWRIGHT_ARTIFACT_ROOT ??
  (process.env.PLAYWRIGHT_REUSE_SERVER === '1'
    ? path.join(os.tmpdir(), 'careviax-playwright-artifacts', String(process.pid))
    : undefined) ??
  path.join(process.cwd(), 'tools', 'tests', '.artifacts');

const auditRunId = process.env.PLAYWRIGHT_AUDIT_RUN_ID?.trim();
if (auditRunId && !/^[A-Za-z0-9_-]+$/.test(auditRunId)) {
  throw new Error(
    'PLAYWRIGHT_AUDIT_RUN_ID must contain only letters, numbers, hyphens, or underscores',
  );
}

export const PLAYWRIGHT_OUTPUT_DIR = path.join(ARTIFACT_ROOT, 'results');
export const PLAYWRIGHT_REPORT_DIR = path.join(ARTIFACT_ROOT, 'report');
export const PLAYWRIGHT_AUDIT_OUTPUT_DIR = path.join(ARTIFACT_ROOT, 'audit', 'output');
export const PLAYWRIGHT_AUDIT_REPORT_DIR = path.join(ARTIFACT_ROOT, 'audit', 'report');
export const PLAYWRIGHT_AUDIT_JSON_REPORT = path.join(
  ARTIFACT_ROOT,
  'audit',
  'evidence',
  auditRunId ? `report-${auditRunId}.json` : 'report.json',
);
export const PLAYWRIGHT_SCREENSHOT_DIR = path.join(ARTIFACT_ROOT, 'screenshots');
export const PLAYWRIGHT_ELEMENT_SCREENSHOT_DIR = path.join(ARTIFACT_ROOT, 'element-screens');
export const PLAYWRIGHT_UI_SCREENSHOT_DIR = path.join(ARTIFACT_ROOT, 'ui');
