import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  drugAlertRuleFindManyMock,
  drugAlertRuleCountMock,
  drugAlertRuleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  drugAlertRuleFindManyMock: vi.fn(),
  drugAlertRuleCountMock: vi.fn(),
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
    drugAlertRuleCountMock.mockResolvedValue(1);
    drugAlertRuleCreateMock.mockResolvedValue({ id: 'rule_2' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        drugAlertRule: {
          findMany: drugAlertRuleFindManyMock,
          count: drugAlertRuleCountMock,
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
      take: 200,
    });
    expect(drugAlertRuleCountMock).toHaveBeenCalledWith({
      where: {
        OR: [{ org_id: 'org_1' }, { org_id: null }],
      },
    });
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['data', 'meta']);
    expect(body).toMatchObject({
      data: [{ id: 'rule_1' }],
      meta: {
        total_count: 1,
        visible_count: 1,
        hidden_count: 0,
        truncated: false,
        count_basis: 'drug_alert_rules',
        filters_applied: { alert_type: null },
        limit: 200,
      },
    });
    expect(body).not.toHaveProperty('total_count');
    expect(body).not.toHaveProperty('visible_count');
    expect(body).not.toHaveProperty('hidden_count');
    expect(body).not.toHaveProperty('truncated');
    expect(body).not.toHaveProperty('count_basis');
    expect(body).not.toHaveProperty('filters_applied');
    expect(body).not.toHaveProperty('limit');
  });

  it.each([
    ['?limit=5', 5],
    ['?limit=9999', 500],
    ['?limit=0', 1],
    ['?limit=abc', 200],
  ])('bounds alert rule list limit %s to %d', async (search, expectedTake) => {
    const response = (await GET(createGetRequest(search)))!;

    expect(response.status).toBe(200);
    expect(drugAlertRuleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: expectedTake,
      }),
    );
  });

  it('preserves valid alert_type filters when applying the list limit', async () => {
    const response = (await GET(createGetRequest('?alert_type=interaction&limit=5')))!;

    expect(response.status).toBe(200);
    expect(drugAlertRuleFindManyMock).toHaveBeenCalledWith({
      where: {
        alert_type: 'interaction',
        OR: [{ org_id: 'org_1' }, { org_id: null }],
      },
      orderBy: [{ alert_type: 'asc' }, { org_id: 'desc' }, { updated_at: 'desc' }],
      take: 5,
    });
    expect(drugAlertRuleCountMock).toHaveBeenCalledWith({
      where: {
        alert_type: 'interaction',
        OR: [{ org_id: 'org_1' }, { org_id: null }],
      },
    });
  });

  it('returns counted metadata when the bounded alert rule list is truncated', async () => {
    drugAlertRuleFindManyMock.mockResolvedValueOnce([{ id: 'rule_1' }]);
    drugAlertRuleCountMock.mockResolvedValueOnce(3);

    const response = (await GET(createGetRequest('?alert_type=interaction&limit=1')))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'rule_1' }],
      meta: {
        total_count: 3,
        visible_count: 1,
        hidden_count: 2,
        truncated: true,
        count_basis: 'drug_alert_rules',
        filters_applied: { alert_type: 'interaction' },
        limit: 1,
      },
    });
  });

  it('rejects unsupported alert_type filters before querying rules', async () => {
    const response = (await GET(createGetRequest('?alert_type=unsupported')))!;

    expect(response.status).toBe(400);
    expect(drugAlertRuleFindManyMock).not.toHaveBeenCalled();
    expect(drugAlertRuleCountMock).not.toHaveBeenCalled();
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
    await expect(response.json()).resolves.toEqual({ data: { id: 'rule_2' } });
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
