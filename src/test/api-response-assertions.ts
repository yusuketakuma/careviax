import { expect } from 'vitest';

const DEFAULT_FORBIDDEN_PHI_EXPORT_MARKERS = [
  '山田 太郎',
  '東京都千代田区1-1-1',
  '03-1234-5678',
  '090-1234-5678',
  '保険者番号',
  '12345678',
  'アムロジピン',
  'storageKey',
  'objectKey',
  'signed.example',
  'token=secret',
  'provider raw error',
  '家族へ事前共有',
];

export function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

export function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

export function expectPhiExportSnapshotRedacted(
  payload: string,
  extraForbiddenMarkers: string[] = [],
) {
  for (const marker of [...DEFAULT_FORBIDDEN_PHI_EXPORT_MARKERS, ...extraForbiddenMarkers]) {
    expect(payload).not.toContain(marker);
  }
}
