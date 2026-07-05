import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  createAuditLogEntryMock,
  listContactProfilesMock,
  listContactProfileSearchSummariesMock,
  updateContactProfileMock,
} = vi.hoisted(() => ({
  createAuditLogEntryMock: vi.fn(),
  listContactProfilesMock: vi.fn(),
  listContactProfileSearchSummariesMock: vi.fn(),
  updateContactProfileMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'admin' },
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext = emptyRouteContext) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: (_orgId: string, callback: (tx: unknown) => Promise<unknown> | unknown) =>
    callback({}),
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/lib/contact-profiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/contact-profiles')>();
  return {
    ...actual,
    listContactProfileSearchSummaries: listContactProfileSearchSummariesMock,
    listContactProfiles: listContactProfilesMock,
    updateContactProfile: updateContactProfileMock,
  };
});

import { GET, PATCH } from './route';

function createAuthRequest(url: string) {
  return new NextRequest(url);
}

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/contact-profiles', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('/api/contact-profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listContactProfilesMock.mockResolvedValue([
      {
        id: 'contact_1',
        kind: 'external_professional',
        name: '山田 ケアマネ',
        subtitle: '居宅支援A',
        phone: '03-1111-2222',
        email: null,
        fax: '03-1111-3333',
        preferred_contact_method: 'fax',
        preferred_contact_time: '平日 14:00-17:00',
        last_contacted_at: new Date('2026-03-30T00:00:00.000Z'),
        last_success_channel: 'fax',
        recommended_channels: ['fax', 'phone'],
        contact_reliability: {
          ready: true,
          warnings: [],
          missing_channel_labels: [],
        },
        active_patient_count: 4,
        pending_response_count: 2,
      },
    ]);
    listContactProfileSearchSummariesMock.mockResolvedValue({
      data: [
        {
          id: 'contact_1',
          kind: 'external_professional',
          name: '山田 ケアマネ',
          subtitle: '居宅支援A',
          phone: '03-1111-2222',
          email: 'care@example.com',
          fax: '03-1111-3333',
          preferred_contact_method: 'fax',
          pending_response_count: 2,
          last_contacted_at: new Date('2026-03-30T00:00:00.000Z'),
        },
      ],
      hasMore: false,
    });
    updateContactProfileMock.mockResolvedValue({
      before: { id: 'contact_1', name: 'Before' },
      after: { id: 'contact_1', name: 'After' },
    });
    createAuditLogEntryMock.mockResolvedValue(undefined);
  });

  it('lists aggregated contact profiles by kind and query', async () => {
    const response = (await GET(
      createAuthRequest(
        'http://localhost/api/contact-profiles?kind=external_professional&q=%E5%B1%B1%E7%94%B0',
      ),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(listContactProfilesMock).toHaveBeenCalledWith(expect.anything(), 'org_1', {
      kind: 'external_professional',
      query: '山田',
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'contact_1',
          last_contacted_at: '2026-03-30T00:00:00.000Z',
          recommended_channels: ['fax', 'phone'],
          contact_reliability: {
            ready: true,
            warnings: [],
            missing_channel_labels: [],
          },
          active_patient_count: 4,
          pending_response_count: 2,
        },
      ],
    });
  });

  it('uses the bounded minimal search projection when limit is present', async () => {
    const response = (await GET(
      createAuthRequest(
        'http://localhost/api/contact-profiles?kind=external_professional&q=%E5%B1%B1%E7%94%B0&limit=8',
      ),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(listContactProfileSearchSummariesMock).toHaveBeenCalledWith(expect.anything(), 'org_1', {
      kind: 'external_professional',
      query: '山田',
      limit: 8,
    });
    expect(listContactProfilesMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          id: 'contact_1',
          kind: 'external_professional',
          name: '山田 ケアマネ',
          subtitle: '居宅支援A',
          last_contacted_at: '2026-03-30T00:00:00.000Z',
        },
      ],
      hasMore: false,
    });
    expect(body.data[0]).not.toHaveProperty('phone');
    expect(body.data[0]).not.toHaveProperty('email');
    expect(body.data[0]).not.toHaveProperty('fax');
    expect(body.data[0]).not.toHaveProperty('preferred_contact_method');
    expect(body.data[0]).not.toHaveProperty('pending_response_count');
  });

  it('returns a sanitized no-store 500 when contact profile listing fails unexpectedly', async () => {
    listContactProfilesMock.mockRejectedValueOnce(
      new Error('raw contact profile patient communication secret'),
    );

    const response = (await GET(
      createAuthRequest('http://localhost/api/contact-profiles?kind=external_professional'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('patient communication secret');
  });

  it('returns a no-store validation error for malformed PATCH bodies', async () => {
    const response = (await PATCH(
      new NextRequest('http://localhost/api/contact-profiles', {
        method: 'PATCH',
        body: 'not-json',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(updateContactProfileMock).not.toHaveBeenCalled();
  });

  it('returns a no-store validation error with field details for invalid PATCH payloads', async () => {
    const response = (await PATCH(createPatchRequest({ kind: 'external_professional', id: '' }), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        id: expect.any(Array),
      },
    });
    expect(updateContactProfileMock).not.toHaveBeenCalled();
  });

  it('returns a no-store not-found envelope when PATCH target is missing', async () => {
    updateContactProfileMock.mockResolvedValueOnce(null);

    const response = (await PATCH(
      createPatchRequest({
        kind: 'external_professional',
        id: 'missing_contact',
        name: '山田 ケアマネ',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(404);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '連携先が見つかりません',
    });
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns sanitized no-store 500 when PATCH fails unexpectedly', async () => {
    updateContactProfileMock.mockRejectedValueOnce(
      new Error('raw contact profile phone secret 03-1111-2222'),
    );

    const response = (await PATCH(
      createPatchRequest({
        kind: 'external_professional',
        id: 'contact_1',
        name: '山田 ケアマネ',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('03-1111-2222');
    expect(JSON.stringify(body)).not.toContain('phone secret');
  });
});
