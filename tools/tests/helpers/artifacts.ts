import path from 'node:path';

const ARTIFACT_ROOT = path.join(process.cwd(), 'tools', 'tests', '.artifacts');

export const PLAYWRIGHT_OUTPUT_DIR = path.join(ARTIFACT_ROOT, 'results');
export const PLAYWRIGHT_REPORT_DIR = path.join(ARTIFACT_ROOT, 'report');
export const PLAYWRIGHT_AUDIT_OUTPUT_DIR = path.join(ARTIFACT_ROOT, 'audit', 'output');
export const PLAYWRIGHT_AUDIT_REPORT_DIR = path.join(ARTIFACT_ROOT, 'audit', 'report');
export const PLAYWRIGHT_AUDIT_JSON_REPORT = path.join(
  ARTIFACT_ROOT,
  'audit',
  'report',
  'report.json'
);
export const PLAYWRIGHT_SCREENSHOT_DIR = path.join(ARTIFACT_ROOT, 'screenshots');
export const PLAYWRIGHT_ELEMENT_SCREENSHOT_DIR = path.join(ARTIFACT_ROOT, 'element-screens');
export const PLAYWRIGHT_UI_SCREENSHOT_DIR = path.join(ARTIFACT_ROOT, 'ui');
