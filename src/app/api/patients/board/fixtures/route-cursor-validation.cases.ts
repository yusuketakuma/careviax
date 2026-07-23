import { expect, it, vi } from 'vitest';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';
import { getPatientBoardRouteTestSupport } from './route.test-support';

const { patientFindManyMock, patientCountMock, GET, createRequest, buildPatientRow } =
  getPatientBoardRouteTestSupport();

export function registerPatientBoardRouteCursorValidationCases() {
  it('rejects tampered and filter-mismatched cursors before querying patients', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-20T00:00:00.000Z')),
        id: 'patient_a',
        name: '患者 A',
      },
      {
        ...buildPatientRow(new Date('2026-06-21T00:00:00.000Z')),
        id: 'patient_b',
        name: '患者 B',
      },
    ]);
    patientCountMock.mockResolvedValue(2);

    const first = (await GET(createRequest('?scope=all&limit=1'), {
      params: Promise.resolve({}),
    }))!;
    const firstJson = await first.json();
    const cursor = firstJson.meta.next_cursor as string;
    expect(cursor).toEqual(expect.any(String));

    patientFindManyMock.mockClear();
    patientCountMock.mockClear();

    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`;
    const tamperedResponse = (await GET(
      createRequest(`?scope=all&limit=1&cursor=${encodeURIComponent(tampered)}`),
      { params: Promise.resolve({}) },
    ))!;
    expect(tamperedResponse.status).toBe(400);
    expectSensitiveNoStore(tamperedResponse);
    const tamperedBody = await tamperedResponse.json();
    expect(JSON.stringify(tamperedBody)).not.toContain(tampered);
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(patientCountMock).not.toHaveBeenCalled();

    const mismatchResponse = (await GET(
      createRequest(`?scope=mine&limit=1&cursor=${encodeURIComponent(cursor)}`),
      { params: Promise.resolve({}) },
    ))!;
    expect(mismatchResponse.status).toBe(400);
    expectSensitiveNoStore(mismatchResponse);
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(patientCountMock).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-06-12T08:11:00+09:00'));
    const expiredResponse = (await GET(
      createRequest(`?scope=all&limit=1&cursor=${encodeURIComponent(cursor)}`),
      { params: Promise.resolve({}) },
    ))!;
    expect(expiredResponse.status).toBe(400);
    expectSensitiveNoStore(expiredResponse);
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(patientCountMock).not.toHaveBeenCalled();
  });

  it('does not echo raw q or patient identifiers inside cursor metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-20T00:00:00.000Z')),
        id: 'patient_sensitive_a',
        name: '患者 A',
      },
      {
        ...buildPatientRow(new Date('2026-06-21T00:00:00.000Z')),
        id: 'patient_sensitive_b',
        name: '患者 B',
      },
    ]);
    patientCountMock.mockResolvedValue(2);
    const rawQuery = '東京都千代田区丸の内1-1-1';

    const response = (await GET(
      createRequest(`?scope=all&limit=1&q=${encodeURIComponent(rawQuery)}`),
      { params: Promise.resolve({}) },
    ))!;
    expect(response.status).toBe(200);
    const bodyText = await response.text();
    const json = JSON.parse(bodyText);
    expect(json.meta.filters_applied).toMatchObject({
      q_present: true,
      card_filter: 'all',
      sort: 'priority',
    });
    expect(json.meta.next_cursor).toEqual(expect.any(String));
    expect(json.meta.next_cursor).not.toContain('patient_sensitive');
    expect(json.meta.next_cursor).not.toContain(rawQuery);
    expect(
      json.meta.next_cursor
        .split('.')
        .map((part: string) => Buffer.from(part, 'base64url').toString('utf8'))
        .join(''),
    ).not.toContain('patient_sensitive');
    expect(bodyText).not.toContain(rawQuery);
  });

  it('applies q as a database-side patient name/kana filter before taking board rows', async () => {
    const response = (await GET(createRequest('?scope=all&q=%E4%BD%90%E8%97%A4'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          archived_at: null,
          OR: expect.arrayContaining([
            { name: { contains: '佐藤', mode: 'insensitive' } },
            { name_kana: { contains: '佐藤', mode: 'insensitive' } },
            expect.objectContaining({
              residences: expect.objectContaining({ some: expect.any(Object) }),
            }),
            expect.objectContaining({
              contacts: expect.objectContaining({ some: expect.any(Object) }),
            }),
            expect.objectContaining({
              cases: expect.objectContaining({ some: expect.any(Object) }),
            }),
          ]),
        }),
      }),
    );
    expect(patientCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { name: { contains: '佐藤', mode: 'insensitive' } },
          { name_kana: { contains: '佐藤', mode: 'insensitive' } },
        ]),
      }),
    });
  });

  it('applies q to the single base stream before derived foundation filtering', async () => {
    const response = (await GET(
      createRequest('?scope=all&q=%E4%BD%90%E8%97%A4&foundation_issue=missing_insurance'),
      {
        params: Promise.resolve({}),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          archived_at: null,
          OR: expect.arrayContaining([
            { name: { contains: '佐藤', mode: 'insensitive' } },
            { name_kana: { contains: '佐藤', mode: 'insensitive' } },
          ]),
        }),
      }),
    );
    expect(patientFindManyMock.mock.calls[0][0].where.AND).toBeUndefined();
    expect(patientFindManyMock).toHaveBeenCalledTimes(1);
    expect(patientCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { name: { contains: '佐藤', mode: 'insensitive' } },
          { name_kana: { contains: '佐藤', mode: 'insensitive' } },
        ]),
      }),
    });
  });

  it('rejects invalid board foundation issue values before querying patients', async () => {
    const response = (await GET(createRequest('?scope=all&foundation_issue=unknown'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'クエリパラメータが不正です',
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(patientCountMock).not.toHaveBeenCalled();
  });

  it('returns a fixed sensitive no-store error when board aggregate reads fail', async () => {
    patientFindManyMock.mockRejectedValueOnce(new Error('raw patient board failure'));

    const response = (await GET(createRequest('?scope=all'), {
      params: Promise.resolve({}),
    }))!;
    const body = await response.json();

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('サーバー内部でエラーが発生しました');
    expect(JSON.stringify(body)).not.toContain('raw patient board failure');
  });

  it.each([
    ['scope', '?scope=mine&scope=all', { scope: ['scope は1つだけ指定してください'] }],
    ['q', '?scope=all&q=a&q=b', { q: ['q は1つだけ指定してください'] }],
    ['limit', '?scope=all&limit=10&limit=20', { limit: ['limit は1つだけ指定してください'] }],
    ['cursor', '?scope=all&cursor=a&cursor=b', { cursor: ['cursor は1つだけ指定してください'] }],
    [
      'foundation_issue',
      '?scope=all&foundation_issue=missing_contact&foundation_issue=missing_care_team',
      { foundation_issue: ['foundation_issue は1つだけ指定してください'] },
    ],
  ])(
    'rejects duplicate board query parameter %s before querying patients',
    async (_name, search, details) => {
      const response = (await GET(createRequest(search), { params: Promise.resolve({}) }))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: 'クエリパラメータが不正です',
        details,
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(patientCountMock).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '101', 'abc'] as const)(
    'rejects invalid limit %s before querying patients',
    async (limit) => {
      const response = (await GET(createRequest(`?scope=all&limit=${limit}`), {
        params: Promise.resolve({}),
      }))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: 'クエリパラメータが不正です',
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(patientCountMock).not.toHaveBeenCalled();
    },
  );
}
