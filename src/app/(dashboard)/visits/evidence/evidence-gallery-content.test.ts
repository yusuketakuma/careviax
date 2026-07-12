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
              visit_date: '2026-04-20T10:00:00.000Z',
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
          meta: { has_more: false, next_cursor: null },
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

  it('surfaces API messages from failed gallery list requests', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: 'API側の証跡一覧エラー' }, 503));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVisitRecordsWithAttachments('org_1')).rejects.toThrow(
      'API側の証跡一覧エラー',
    );
  });

  it('rejects malformed or duplicate successful gallery payloads', async () => {
    const record = {
      id: 'visit_1',
      visit_date: '2026-04-20T10:00:00.000Z',
      created_at: '2026-04-20T09:00:00.000Z',
      attachments: [
        {
          file_id: 'file_1',
          file_name: '残薬写真_01.jpg',
          uploaded_at: '2026-04-20T09:05:00.000Z',
          kind: 'photo',
        },
      ],
    };
    const payloads = [
      { records: [record], meta: { has_more: false, next_cursor: null } },
      { data: [record], meta: { has_more: false, next_cursor: 'cursor_1' } },
      {
        data: [record, { ...record, id: 'visit_2' }],
        meta: { has_more: false, next_cursor: null },
      },
      {
        data: Array.from({ length: 13 }, (_, index) => ({
          ...record,
          id: `visit_${index}`,
          attachments: [],
        })),
        meta: { has_more: true, next_cursor: 'cursor_1' },
      },
    ];

    for (const payload of payloads) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(payload)),
      );
      await expect(fetchVisitRecordsWithAttachments('org_1')).rejects.toThrow(
        '訪問記録の取得に失敗しました',
      );
    }
  });
});
