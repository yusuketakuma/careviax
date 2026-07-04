// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { DataExplorerPanel } from './data-explorer-panel';

setupDomTestEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DataExplorerPanel', () => {
  it('uses a model-specific loading label while loading model metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/platform/break-glass') {
          return new Response(
            JSON.stringify({
              sessions: [
                {
                  id: 'session_1',
                  target_org_id: 'org_1',
                  reason: '監査確認',
                  reference_ticket: null,
                  scope: 'read_only',
                  status: 'active',
                  granted_at: '2026-07-04T00:00:00.000Z',
                  expires_at: '2026-07-04T01:00:00.000Z',
                  revoked_at: null,
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/platform/tenants/org_1/data') {
          return new Promise<Response>(() => undefined);
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(<DataExplorerPanel orgId="org_1" />, { wrapper: createQueryClientWrapper() });

    expect(await screen.findByText('データモデルを読み込み中...')).toBeTruthy();
    expect(screen.queryByText('読み込み中...')).toBeNull();
  });
});
