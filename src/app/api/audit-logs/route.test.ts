import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, findManyMock, countMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    auditLog: {
      findMany: findManyMock,
      count: countMock,
    },
  },
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(headers?: Record<string, string>, search = 'limit=10') {
  return new NextRequest(`http://localhost/api/audit-logs?${search}`, {
    headers,
  });
}

describe('/api/audit-logs GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = (await GET(createRequest(), emptyRouteContext)) as Response;

    expect(response.status).toBe(401);
  });

  it('returns 403 when the role lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns 200 when the role has permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledOnce();
    expect(countMock).toHaveBeenCalledOnce();
  });

  it('defaults malformed pagination params before querying audit logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'page=2abc&limit=10abc'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      pagination: {
        page: 1,
        limit: 20,
      },
    });
  });

  it('caps oversized pagination params before querying audit logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'page=999999999&limit=500'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 999_900,
        take: 100,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      pagination: {
        page: 10000,
        limit: 100,
      },
    });
  });

  it('supports UI filter parameter names, actor context filters, and inclusive date ranges', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest(
        { 'x-org-id': 'org_1' },
        'actor=user_99&actor_pharmacy_id=org_1&actor_site_id=site_1&patient_id=patient_1&target_type=visit_record&action=export&date_from=2026-03-01&date_to=2026-03-31',
      ),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          actor_id: 'user_99',
          actor_pharmacy_id: 'org_1',
          actor_site_id: 'site_1',
          patient_id: 'patient_1',
          target_type: 'visit_record',
          action: 'export',
          created_at: {
            gte: new Date('2026-03-01T00:00:00.000Z'),
            lte: new Date('2026-03-31T23:59:59.999Z'),
          },
        }),
      }),
    );
  });

  it.each([
    ['patient', 'consent_records_viewed'],
    ['consent_record', 'consent_record_viewed'],
    ['consent_record', 'consent_record_created'],
    ['consent_record', 'consent_record_updated'],
    ['consent_record', 'consent_record_revoked'],
    ['PatientShareCase', 'patient_share_cases_viewed'],
    ['PatientShareCase', 'patient_share_case_created'],
    ['PatientShareCase', 'patient_share_case_activated'],
    ['PatientShareConsent', 'patient_share_consents_viewed'],
    ['PatientShareConsent', 'patient_share_consent_registered'],
    ['PatientShareConsent', 'patient_share_consent_revoked'],
    ['patient_share_consent', 'patient_share_consent.update'],
    ['PatientShareCorrectionRequest', 'patient_share_correction_requests_viewed'],
    ['PatientLink', 'patient_link_accepted'],
    ['file_asset', 'file_download'],
    ['care_report', 'care_report_print_requested'],
  ])('supports v0.2 audit vocabulary target_type=%s action=%s', async (targetType, action) => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const search = new URLSearchParams({
      target_type: targetType,
      action,
      limit: '10',
    }).toString();
    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, search),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          target_type: targetType,
          action,
        }),
      }),
    );
    expect(countMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        target_type: targetType,
        action,
      }),
    });
  });

  it('redacts proposal reject free text before returning audit logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockResolvedValue([
      {
        id: 'audit_reject_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'visit_schedule_proposal_rejected',
        target_type: 'VisitScheduleProposal',
        target_id: 'proposal_1',
        changes: {
          reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
        },
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        created_at: new Date('2026-04-09T00:00:00.000Z'),
      },
    ]);
    countMock.mockResolvedValue(1);

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }),
      emptyRouteContext,
    )) as Response;
    const body = await response.json();
    const bodyText = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.data[0].changes).toMatchObject({
      reject_reason: '却下理由の自由記載は出力対象外です',
      reject_reason_redacted: true,
    });
    expect(bodyText).not.toContain('東京都港区2-2-2');
    expect(bodyText).not.toContain('090-1234-5678');
    expect(bodyText).not.toContain('アムロジピン');
    expect(bodyText).not.toContain('処方詳細');
  });
});
