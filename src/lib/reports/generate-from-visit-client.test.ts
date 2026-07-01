import { afterEach, describe, expect, it, vi } from 'vitest';

const { buildOrgJsonHeadersMock } = vi.hoisted(() => ({
  buildOrgJsonHeadersMock: vi.fn((orgId: string) => ({
    'Content-Type': 'application/json',
    'x-org-id': `org-json:${orgId}`,
  })),
}));

vi.mock('@/lib/api/org-headers', () => ({
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
}));

import { buildGenerateCareReportFromVisitApiPath } from './api-paths';
import { generateCareReportFromVisit } from './generate-from-visit-client';

describe('generateCareReportFromVisit', () => {
  afterEach(() => {
    buildOrgJsonHeadersMock.mockClear();
    vi.unstubAllGlobals();
  });

  it('posts visit generation payload with org and version headers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'report_1',
              report_type: 'physician_report',
              status: 'draft',
              updated_at: '2026-03-29T01:00:00.000Z',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateCareReportFromVisit({
        orgId: 'org_1',
        visitRecordId: 'visit_1',
        expectedVisitRecordUpdatedAt: '2026-03-29T00:00:00.000Z',
      }),
    ).resolves.toEqual([
      {
        id: 'report_1',
        report_type: 'physician_report',
        status: 'draft',
        updated_at: '2026-03-29T01:00:00.000Z',
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(buildGenerateCareReportFromVisitApiPath(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org-json:org_1',
      },
      body: JSON.stringify({
        visit_record_id: 'visit_1',
        expected_visit_record_updated_at: '2026-03-29T00:00:00.000Z',
      }),
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('includes explicit report regeneration contract when supplied', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'report_2',
              report_type: 'physician_report',
              status: 'draft',
              updated_at: '2026-03-29T01:00:00.000Z',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await generateCareReportFromVisit({
      orgId: 'org_1',
      visitRecordId: 'visit_1',
      expectedVisitRecordUpdatedAt: '2026-03-29T00:00:00.000Z',
      reportType: 'physician_report',
      expectedReportUpdatedAt: '2026-03-30T00:00:00.000Z',
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      visit_record_id: 'visit_1',
      expected_visit_record_updated_at: '2026-03-29T00:00:00.000Z',
      report_type: 'physician_report',
      expected_report_updated_at: '2026-03-30T00:00:00.000Z',
    });
  });

  it('throws the API JSON error message when generation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ message: '訪問記録が更新されています' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(
      generateCareReportFromVisit({
        orgId: 'org_1',
        visitRecordId: 'visit_1',
        expectedVisitRecordUpdatedAt: 'stale',
      }),
    ).rejects.toThrow('訪問記録が更新されています');
  });

  it('keeps the legacy empty array fallback when the response omits data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(
      generateCareReportFromVisit({
        orgId: 'org_1',
        visitRecordId: 'visit_1',
        expectedVisitRecordUpdatedAt: '2026-03-29T00:00:00.000Z',
      }),
    ).resolves.toEqual([]);
  });

  it('rejects malformed successful API payloads with the fallback message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'report_1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(
      generateCareReportFromVisit(
        {
          orgId: 'org_1',
          visitRecordId: 'visit_1',
          expectedVisitRecordUpdatedAt: '2026-03-29T00:00:00.000Z',
        },
        '生成に失敗しました',
      ),
    ).rejects.toThrow('生成に失敗しました');
  });

  it('uses the fallback message for non-JSON API failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('upstream failed', { status: 500 })),
    );

    await expect(
      generateCareReportFromVisit(
        {
          orgId: 'org_1',
          visitRecordId: 'visit_1',
          expectedVisitRecordUpdatedAt: '2026-03-29T00:00:00.000Z',
        },
        '生成に失敗しました',
      ),
    ).rejects.toThrow('生成に失敗しました');
  });
});
