import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  withOrgContextMock,
  pharmacyPartnershipFindFirstMock,
  pharmacyPartnershipUpdateManyMock,
  pharmacyPartnershipFindUniqueOrThrowMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  pharmacyPartnershipFindFirstMock: vi.fn(),
  pharmacyPartnershipUpdateManyMock: vi.fn(),
  pharmacyPartnershipFindUniqueOrThrowMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { POST as rawPOST } from './route';
import { pharmacyPartnershipRowSchema } from '@/lib/pharmacy-cooperation/api-contracts';

const routeContext = { params: Promise.resolve({ id: 'partnership_1' }) };

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-partnerships/partnership_1/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function expectSuccessDataEnvelope(response: Response) {
  expect(response.status).toBe(200);
  expectSensitiveNoStore(response);
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(['data']);
  expect(pharmacyPartnershipRowSchema.safeParse(body.data).success).toBe(true);
  return body as { data: Record<string, unknown> };
}

async function expectErrorEnvelope(
  response: Response,
  status: number,
  expected: Record<string, unknown>,
) {
  expect(response.status).toBe(status);
  expectSensitiveNoStore(response);
  const body = await response.json();
  expect(body).toMatchObject(expected);
  expect(body).not.toHaveProperty('data');
  return body as Record<string, unknown>;
}

describe('/api/pharmacy-partnerships/[id]/activate POST', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));
    vi.clearAllMocks();
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'draft',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      approved_by_base: null,
      approved_by_partner: null,
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });
    pharmacyPartnershipUpdateManyMock.mockResolvedValue({ count: 1 });
    pharmacyPartnershipFindUniqueOrThrowMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'active',
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      approved_by_base: 'base_manager',
      approved_by_partner: 'partner_manager',
      approved_at: new Date('2026-06-19T00:00:00.000Z'),
      updated_by: 'user_1',
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyPartnership: {
          findFirst: pharmacyPartnershipFindFirstMock,
          updateMany: pharmacyPartnershipUpdateManyMock,
          findUniqueOrThrow: pharmacyPartnershipFindUniqueOrThrowMock,
        },
      }),
    );
  });

  it('activates a draft partnership with both pharmacy approvals', async () => {
    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    const body = await expectSuccessDataEnvelope(response);
    expect(pharmacyPartnershipUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'partnership_1',
        org_id: 'org_1',
        status: { in: ['draft', 'suspended'] },
        partner_pharmacy: { status: 'active' },
        AND: [
          {
            OR: [
              { effective_from: null },
              { effective_from: { lt: new Date('2026-06-20T00:00:00.000Z') } },
            ],
          },
          {
            OR: [
              { effective_to: null },
              { effective_to: { gte: new Date('2026-06-19T00:00:00.000Z') } },
            ],
          },
        ],
      },
      data: {
        status: 'active',
        approved_by_base: 'base_manager',
        approved_by_partner: 'partner_manager',
        approved_at: new Date('2026-06-19T00:00:00.000Z'),
        updated_by: 'user_1',
      },
    });
    expect(body).not.toHaveProperty('id');
    expect(body.data).not.toHaveProperty('approved_by_base');
    expect(body.data).not.toHaveProperty('approved_by_partner');
    expect(body.data).not.toHaveProperty('approved_at');
    expect(body.data).not.toHaveProperty('updated_by');
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_partnership_activated',
        targetType: 'PharmacyPartnership',
        targetId: 'partnership_1',
        changes: expect.objectContaining({
          previous_status: 'draft',
          status: 'active',
          base_approved: true,
          partner_approved: true,
        }),
      }),
    );
  });

  it('rejects activation without partner approval before update or audit side effects', async () => {
    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
      }),
      routeContext,
    );

    await expectErrorEnvelope(response, 400, {
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        partner_approved_by: ['有効化には協力薬局側の承認記録が必要です'],
      },
    });
    expect(pharmacyPartnershipUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('documents that active no-op requests still require valid approval payloads', async () => {
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'active',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      approved_by_base: 'base_manager',
      approved_by_partner: 'partner_manager',
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });

    const response = await rawPOST(createRequest({}), routeContext);

    await expectErrorEnvelope(response, 400, {
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(pharmacyPartnershipFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacyPartnershipUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects inactive partner pharmacies before update or audit side effects', async () => {
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'draft',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      approved_by_base: null,
      approved_by_partner: null,
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'inactive' },
    });

    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    await expectErrorEnvelope(response, 409, {
      code: 'WORKFLOW_CONFLICT',
      message: '有効な協力薬局との連携のみ有効化できます',
    });
    expect(pharmacyPartnershipUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns not found as a root ApiError with sensitive no-store headers', async () => {
    pharmacyPartnershipFindFirstMock.mockResolvedValue(null);

    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    await expectErrorEnvelope(response, 404, {
      code: 'WORKFLOW_NOT_FOUND',
      message: '薬局間連携が見つかりません',
    });
    expect(pharmacyPartnershipUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns an already active partnership without writing another audit entry', async () => {
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'active',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-12-31T00:00:00.000Z'),
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      approved_by_base: 'base_manager',
      approved_by_partner: 'partner_manager',
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });

    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    const body = await expectSuccessDataEnvelope(response);
    expect(body).toMatchObject({
      data: {
        id: 'partnership_1',
        status: 'active',
        base_site: { id: 'site_1', name: '基幹薬局' },
        partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      },
    });
    expect(pharmacyPartnershipUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns active partnership when a concurrent activation wins the update race', async () => {
    pharmacyPartnershipUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    const body = await expectSuccessDataEnvelope(response);
    expect(body).toMatchObject({
      data: {
        id: 'partnership_1',
        status: 'active',
        base_site: { id: 'site_1', name: '基幹薬局' },
        partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      },
    });
    expect(pharmacyPartnershipFindUniqueOrThrowMock).toHaveBeenCalledWith({
      where: { id_org_id: { id: 'partnership_1', org_id: 'org_1' } },
      include: {
        base_site: { select: { id: true, name: true } },
        partner_pharmacy: { select: { id: true, name: true, status: true } },
      },
    });
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects when the partnership leaves the effective date window before update wins', async () => {
    pharmacyPartnershipUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    pharmacyPartnershipFindUniqueOrThrowMock.mockResolvedValueOnce({
      id: 'partnership_1',
      status: 'draft',
      base_site_id: 'site_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-06-18T00:00:00.000Z'),
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    });

    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    await expectErrorEnvelope(response, 409, {
      code: 'WORKFLOW_CONFLICT',
      message: '薬局間連携の終了日を過ぎています',
    });
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns sanitized no-store internal error when activation loading throws unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw activation failure patient=患者A token=secret'),
    );

    const response = await rawPOST(
      createRequest({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      }),
      routeContext,
    );

    const body = await expectErrorEnvelope(response, 500, {
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('患者A');
    expect(bodyText).not.toContain('token=secret');
    expect(pharmacyPartnershipUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
