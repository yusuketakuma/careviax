import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  drugAlertRuleFindManyMock,
  drugAlertRuleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  drugAlertRuleFindManyMock: vi.fn(),
  drugAlertRuleCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/drug-alert-rules${search}`);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-alert-rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/drug-alert-rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  } satisfies NextRequestInit);
}

describe('/api/drug-alert-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    drugAlertRuleFindManyMock.mockResolvedValue([{ id: 'rule_1' }]);
    drugAlertRuleCreateMock.mockResolvedValue({ id: 'rule_2' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        drugAlertRule: {
          findMany: drugAlertRuleFindManyMock,
          create: drugAlertRuleCreateMock,
        },
      }),
    );
  });

  it('lists alert rules', async () => {
    const response = (await GET(createGetRequest()))!;

    expect(response.status).toBe(200);
    expect(drugAlertRuleFindManyMock).toHaveBeenCalledWith({
      where: {
        OR: [{ org_id: 'org_1' }, { org_id: null }],
      },
      orderBy: [{ alert_type: 'asc' }, { org_id: 'desc' }, { updated_at: 'desc' }],
    });
  });

  it('rejects unsupported alert_type filters before querying rules', async () => {
    const response = (await GET(createGetRequest('?alert_type=unsupported')))!;

    expect(response.status).toBe(400);
    expect(drugAlertRuleFindManyMock).not.toHaveBeenCalled();
  });

  it('creates an alert rule', async () => {
    const response = (await POST(
      createPostRequest({
        alert_type: 'interaction',
        condition: {
          severity_floor: 'warning',
          fallback: null,
          thresholds: [1, null],
        },
        severity: 'warning',
        message: '併用禁忌を確認',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(drugAlertRuleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        alert_type: 'interaction',
        condition: {
          severity_floor: 'warning',
          fallback: null,
          thresholds: [1, null],
        },
        severity: 'warning',
        message: '併用禁忌を確認',
        is_active: true,
      }),
    });
  });

  it('rejects non-object create payloads before opening an org transaction', async () => {
    const response = (await POST(createPostRequest([])))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(drugAlertRuleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before opening an org transaction', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(drugAlertRuleCreateMock).not.toHaveBeenCalled();
  });
});
