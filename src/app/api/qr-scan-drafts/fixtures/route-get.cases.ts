import { expect, it } from 'vitest';
import { getQrScanDraftRouteTestSupport } from './route.test-support';

const {
  withOrgContextMock,
  qrScanDraftFindManyMock,
  qrScanDraftCountMock,
  GET,
  createGetRequest,
  expectSensitiveNoStore,
} = getQrScanDraftRouteTestSupport();

export function registerQrScanDraftGetCases() {
  it('returns unmatched count with the main list when requested', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/qr-scan-drafts?include_unmatched_count=1'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        {
          id: 'draft_1',
          parsed_data: { patient: { name: '山田 太郎' } },
        },
      ],
      meta: { unmatched_count: 3 },
    });
    expect(qrScanDraftFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ org_id: 'org_1', status: 'pending' }),
      }),
    );
    expect(qrScanDraftCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({ org_id: 'org_1', status: 'pending', patient_id: null }),
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('does not run the unmatched count query by default', async () => {
    const response = await GET(createGetRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(qrScanDraftCountMock).not.toHaveBeenCalled();
  });

  it('returns cursor metadata in an exact data/meta envelope', async () => {
    qrScanDraftFindManyMock.mockResolvedValueOnce([
      {
        id: 'draft_2',
        status: 'pending',
        patient_id: null,
        raw_qr_texts: ['secret-2'],
        qr_payload_hash: 'hash_2',
        parsed_data: { patient: { name: '佐藤 花子' }, rawText: 'secret text 2' },
      },
      {
        id: 'draft_1',
        status: 'pending',
        patient_id: null,
        raw_qr_texts: ['secret-1'],
        qr_payload_hash: 'hash_1',
        parsed_data: { patient: { name: '山田 太郎' }, rawText: 'secret text 1' },
      },
    ]);

    const response = await GET(
      createGetRequest('http://localhost/api/qr-scan-drafts?include_unmatched_count=1&limit=1'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['data', 'meta']);
    expect(body).toMatchObject({
      data: [{ id: 'draft_2' }],
      meta: {
        has_more: true,
        next_cursor: 'draft_2',
        unmatched_count: 3,
      },
    });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty('raw_qr_texts');
    expect(body.data[0]).not.toHaveProperty('qr_payload_hash');
    expect(body.data[0].parsed_data).not.toHaveProperty('rawText');
  });

  it('does not mark hasMore when QR scan drafts exactly fill the requested limit', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/qr-scan-drafts?include_unmatched_count=1&limit=1'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['data', 'meta']);
    expect(body).toMatchObject({
      data: [{ id: 'draft_1' }],
      meta: {
        has_more: false,
        next_cursor: null,
        unmatched_count: 3,
      },
    });
    expect(body.data).toHaveLength(1);
  });

  it('returns a fixed no-store 500 when the draft list read fails', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw QR read failed for patient 山田 太郎 insurer 06012345'),
    );

    const response = await GET(createGetRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田 太郎');
    expect(JSON.stringify(body)).not.toContain('06012345');
  });
}
