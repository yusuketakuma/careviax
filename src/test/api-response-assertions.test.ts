import { describe, it } from 'vitest';
import {
  expectNoStore,
  expectPhiExportSnapshotRedacted,
  expectSensitiveNoStore,
} from './api-response-assertions';

describe('api response assertions', () => {
  it('accepts sensitive no-store responses', () => {
    const response = new Response(null, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
      },
    });

    expectSensitiveNoStore(response);
  });

  it('keeps expectNoStore as an alias for sensitive no-store responses', () => {
    const response = new Response(null, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
      },
    });

    expectNoStore(response);
  });

  it('accepts redacted PHI export snapshots', () => {
    expectPhiExportSnapshotRedacted(
      [
        'external_row_id,request_type,status,redaction_profile',
        '"a1b2c3d4e5f60789","inquiry","responded","external"',
        '"handoff-external-redacted"',
      ].join('\n'),
    );
  });
});
