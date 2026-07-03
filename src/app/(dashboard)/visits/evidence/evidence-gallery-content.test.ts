import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchVisitRecordsWithAttachments } from './evidence-gallery-content';
import { jsonResponse } from '@/test/fetch-test-utils';

describe('fetchVisitRecordsWithAttachments', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads gallery attachment summaries with a single list request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/visit-records?limit=12&include_attachments=true&view=evidence_gallery') {
        return jsonResponse({
          data: [
            {
              id: 'visit_1',
              created_at: '2026-04-20T09:00:00.000Z',
              attachments: [
                {
                  file_id: 'file_1',
                  file_name: '残薬写真_01.jpg',
                  uploaded_at: '2026-04-20T09:05:00.000Z',
                  kind: 'photo',
                },
              ],
            },
          ],
        });
      }
      return new Response('unexpected detail fetch', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVisitRecordsWithAttachments('org_1')).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/visit-records?limit=12&include_attachments=true&view=evidence_gallery',
      {
        headers: { 'x-org-id': 'org_1' },
      },
    );
  });
});
