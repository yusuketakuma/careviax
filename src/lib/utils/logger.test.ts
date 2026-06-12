import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSafeLogContext, logger } from './logger';

describe('buildSafeLogContext', () => {
  it('keeps only safe operational values', () => {
    expect(
      buildSafeLogContext({
        event: 'file_storage.complete_failed',
        orgId: 'org_123',
        entityType: 'file',
        entityId: 'file-123',
        code: 'S3_HEAD_FAILED',
      }),
    ).toMatchObject({
      event: 'file_storage.complete_failed',
      orgId: 'org_123',
      entityType: 'file',
      entityId: 'file-123',
      code: 'S3_HEAD_FAILED',
    });
  });

  it('redacts free-text values and invalid event names', () => {
    expect(
      buildSafeLogContext({
        event: 'Upload failed for patient Taro',
        entityId: 'patient name and address',
        code: 'UPLOAD FAILED',
      }),
    ).toMatchObject({
      event: 'invalid_event_name',
      entityId: 'redacted',
      code: 'redacted',
    });
  });
});

describe('logger structured errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not write Error.message or stack to PHI-safe structured error logs', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logger.error(
      {
        event: 'visit_route.preview_failed',
        orgId: 'org-1',
        entityType: 'visit_schedule_proposal',
        entityId: 'proposal-1',
        code: 'ROUTE_PREVIEW_FAILED',
      },
      new Error('patient name: Yamada Taro'),
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      message: 'visit_route.preview_failed',
      event: 'visit_route.preview_failed',
      orgId: 'org-1',
      entityType: 'visit_schedule_proposal',
      entityId: 'proposal-1',
      code: 'ROUTE_PREVIEW_FAILED',
      error_name: 'Error',
    });
    expect(JSON.stringify(entry)).not.toContain('Yamada');
    expect(entry).not.toHaveProperty('stack');
    expect(entry).not.toHaveProperty('error_message');
  });
});
