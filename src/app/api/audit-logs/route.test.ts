import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  findManyMock,
  countMock,
  auditLogReviewFindManyMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  auditLogReviewFindManyMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
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
    auditLogReview: {
      findMany: auditLogReviewFindManyMock,
    },
  },
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
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
    auditLogReviewFindManyMock.mockResolvedValue([]);
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_view_1' });
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = (await GET(createRequest(), emptyRouteContext)) as Response;

    expect(response.status).toBe(401);
    expectNoStore(response);
  });

  it('returns 403 when the role lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(403);
    expectNoStore(response);
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
    expectNoStore(response);
    expect(findManyMock).toHaveBeenCalledOnce();
    expect(countMock).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      summary: {
        high_risk_unreviewed_count: 0,
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'audit_log_viewed',
        targetType: 'audit_log',
        targetId: 'audit_log',
      }),
    );
  });

  it('returns no-store validation errors for invalid date filters before querying audit logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'date_from=not-a-date'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(findManyMock).not.toHaveBeenCalled();
    expect(countMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns no-store validation errors for invalid risk tier filters before querying audit logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'risk_tier=critical'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(findManyMock).not.toHaveBeenCalled();
    expect(countMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when audit log listing fails unexpectedly', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockRejectedValueOnce(new Error('raw audit log patient action secret'));

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('patient action secret');
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
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

  it('audits successful audit log viewing with minimized filter metadata', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockResolvedValue([
      {
        id: 'audit_1',
        org_id: 'org_1',
        actor_id: 'user_2',
        action: 'consent_record_viewed',
        target_type: 'consent_record',
        target_id: 'consent_1',
        changes: {},
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        created_at: new Date('2026-04-09T00:00:00.000Z'),
      },
    ]);
    countMock.mockResolvedValue(1);

    const response = (await GET(
      createRequest(
        { 'x-org-id': 'org_1' },
        'actor=user_99&patient_id=patient_secret&target_type=consent_record&action=consent_record_viewed&risk_tier=high&date_from=2026-03-01&date_to=2026-03-31',
      ),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'audit_log_viewed',
        targetType: 'audit_log',
        targetId: 'audit_log',
        changes: {
          filters: {
            actor_used: true,
            actor_pharmacy_used: false,
            actor_site_used: false,
            patient_used: true,
            targetType: 'consent_record',
            action: 'consent_record_viewed',
            riskTier: 'high',
            from: '2026-03-01T00:00:00.000Z',
            to: '2026-03-31T23:59:59.999Z',
          },
          page: 1,
          limit: 20,
          result_count: 1,
          total_count: 1,
        },
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('patient_secret');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('user_99');
  });

  it('supports the risk tier filter in list queries', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'risk_tier=high'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: expect.any(Array),
        }),
      }),
    );
    expect(countMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        OR: expect.any(Array),
      }),
    });
  });

  it('adds risk tier and redaction state review fields to audit log responses', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockResolvedValue([
      {
        id: 'audit_export_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'export',
        target_type: 'audit_log',
        target_id: 'audit_log',
        changes: {
          format: 'json',
          record_count: 1,
          filters: { riskTier: 'high' },
          metadata: {},
        },
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        created_at: new Date('2026-04-09T00:00:00.000Z'),
      },
    ]);
    countMock.mockResolvedValue(1);
    auditLogReviewFindManyMock.mockResolvedValue([
      {
        audit_log_id: 'audit_export_1',
        review_state: 'reviewed',
        reviewed_at: new Date('2026-04-10T00:00:00.000Z'),
        reviewed_by: 'admin_1',
      },
    ]);

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }),
      emptyRouteContext,
    )) as Response;
    const body = await response.json();

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(body.data[0]).toMatchObject({
      id: 'audit_export_1',
      risk_tier: 'high',
      risk_label: '高リスク',
      risk_reasons: expect.arrayContaining(['data_output', 'audit_export']),
      redaction_state: 'minimized',
      review_state: 'reviewed',
      reviewed_at: '2026-04-10T00:00:00.000Z',
      reviewed_by: 'admin_1',
    });
    expect(body.data[0].changes.filters).toEqual({ riskTier: 'high' });
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

  it('redacts formulary decision free text before returning audit logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockResolvedValue([
      {
        id: 'audit_formulary_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'pharmacy_drug_stock_change_approved',
        target_type: 'FormularyChangeRequest',
        target_id: 'request_1',
        changes: {
          request_id: 'request_1',
          site_id: 'site_1',
          drug_master_id: 'drug_1',
          reason: '患者A 090-1234-5678 の処方に合わせて採用',
          requested_payload: {
            is_stocked: true,
            reorder_point: 10,
            adoption_note: '山田花子 090-1234-5678 アムロジピン',
          },
          current_snapshot: {
            id: 'stock_1',
            is_stocked: false,
            adoption_note: '旧メモ 山田太郎',
          },
          decision_note: '承認理由 患者A 090-1234-5678',
          applied_stock_id: 'stock_2',
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
    expectNoStore(response);
    expect(body.data[0].changes).toMatchObject({
      request_id: 'request_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      reason_present: true,
      reason_length: expect.any(Number),
      reason_redacted: true,
      requested_payload: {
        is_stocked: true,
        reorder_point: 10,
        adoption_note_present: true,
        adoption_note_length: expect.any(Number),
        adoption_note_redacted: true,
      },
      current_snapshot: {
        id: 'stock_1',
        is_stocked: false,
        adoption_note_present: true,
        adoption_note_length: expect.any(Number),
        adoption_note_redacted: true,
      },
      decision_note_present: true,
      decision_note_length: expect.any(Number),
      decision_note_redacted: true,
      applied_stock_id: 'stock_2',
    });
    expect(body.data[0].changes).not.toHaveProperty('reason');
    expect(body.data[0].changes).not.toHaveProperty('decision_note');
    expect(body.data[0].changes.requested_payload).not.toHaveProperty('adoption_note');
    expect(body.data[0].changes.current_snapshot).not.toHaveProperty('adoption_note');
    expect(bodyText).not.toContain('患者A');
    expect(bodyText).not.toContain('090-1234-5678');
    expect(bodyText).not.toContain('山田花子');
    expect(bodyText).not.toContain('山田太郎');
    expect(bodyText).not.toContain('アムロジピン');
  });
});
