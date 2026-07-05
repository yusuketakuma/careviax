import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  findManyMock,
  auditLogReviewFindManyMock,
  recordDataExportAuditMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  auditLogReviewFindManyMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
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
    },
    auditLogReview: {
      findMany: auditLogReviewFindManyMock,
    },
  },
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(headers?: Record<string, string>, search = 'format=csv') {
  return new NextRequest(`http://localhost/api/audit-logs/export?${search}`, {
    headers,
  });
}

function legacyCareReportPdfExportAuditRow() {
  return {
    id: 'audit_care_report_pdf_1',
    org_id: 'org_1',
    actor_id: 'user_1',
    action: 'export',
    target_type: 'care_report',
    target_id: 'report_1',
    changes: {
      format: 'pdf',
      record_count: 1,
      metadata: {
        surface: 'care_report_pdf',
        output_profile: 'external_submission_pdf',
        report_updated_at: '2026-03-28T09:00:00.000Z',
        patient_name: '山田太郎',
        phone: '090-1234-5678',
        medication_name: 'アムロジピン',
        storageKey: 'reports/org_1/raw.pdf',
        signed_url: '=https://signed.example/raw.pdf?token=secret',
        provider_raw_error: 'provider raw error patient 山田',
        content: '処方全文',
      },
    },
    ip_address: '127.0.0.1',
    user_agent: 'vitest',
    created_at: new Date('2026-03-28T00:00:00.000Z'),
  };
}

describe('/api/audit-logs/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([
      {
        id: 'audit_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'export',
        target_type: 'visit_record',
        target_id: 'visit_1',
        changes: { format: 'json', record_count: 1, filters: {}, metadata: {} },
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        created_at: new Date('2026-03-28T00:00:00.000Z'),
      },
    ]);
    auditLogReviewFindManyMock.mockResolvedValue([]);
  });

  it('returns csv payload with UI-compatible filters', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    recordDataExportAuditMock.mockResolvedValue(undefined);

    const response = (await GET(
      createRequest(
        { 'x-org-id': 'org_1' },
        'format=csv&actor=user_1&actor_pharmacy_id=org_1&actor_site_id=site_1&patient_id=patient_1&target_type=visit_record&date_from=2026-03-01&date_to=2026-03-31',
      ),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          actor_id: 'user_1',
          actor_pharmacy_id: 'org_1',
          actor_site_id: 'site_1',
          patient_id: 'patient_1',
          target_type: 'visit_record',
          created_at: {
            gte: new Date('2026-03-01T00:00:00.000Z'),
            lte: new Date('2026-03-31T23:59:59.999Z'),
          },
        }),
      }),
    );

    const body = await response.text();
    expect(body.split('\n')[0]).toContain('actor_pharmacy_id');
    expect(body.split('\n')[0]).toContain('actor_site_id');
    expect(body.split('\n')[0]).toContain('patient_id');
    expect(body.split('\n')[0]).toContain('risk_tier');
    expect(body.split('\n')[0]).toContain('redaction_state');
    expect(body.split('\n')[0]).toContain('review_state');
    expect(body).toContain('"audit_1"');
    expect(body).toContain('"visit_record"');
    expect(body).toContain('"high"');
    expect(body).toContain('"minimized"');
    expect(body).toContain('"pending"');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'audit_log',
        format: 'csv',
        recordCount: 1,
        filters: expect.objectContaining({
          actorPharmacy: 'org_1',
          actorSite: 'site_1',
          patient: 'patient_1',
        }),
      }),
    );
  });

  it('returns json payload when requested', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=json'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        id: 'audit_1',
        action: 'export',
        risk_tier: 'high',
        redaction_state: 'minimized',
        review_state: 'pending',
      }),
    ]);
  });

  it('exports persisted audit review state when present', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    auditLogReviewFindManyMock.mockResolvedValue([
      {
        audit_log_id: 'audit_1',
        review_state: 'reviewed',
        reviewed_at: new Date('2026-03-29T00:00:00.000Z'),
        reviewed_by: 'admin_1',
      },
    ]);

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=json'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        id: 'audit_1',
        review_state: 'reviewed',
        reviewed_at: '2026-03-29T00:00:00.000Z',
        reviewed_by: 'admin_1',
      }),
    ]);
  });

  it('filters and records audit export by risk tier', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=json&risk_tier=high'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: expect.any(Array),
        }),
      }),
    );
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        filters: expect.objectContaining({
          riskTier: 'high',
        }),
      }),
    );
  });

  it('returns no-store validation errors for invalid risk tier filters', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=json&risk_tier=critical'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(findManyMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('preserves safe care report PDF profile fields and redacts hostile legacy metadata in json export payloads', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockResolvedValue([legacyCareReportPdfExportAuditRow()]);

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=json&target_type=care_report&action=export'),
      emptyRouteContext,
    )) as Response;
    const body = await response.json();
    const bodyText = JSON.stringify(body);

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(body[0].changes).toEqual({
      format: 'pdf',
      record_count: 1,
      filters: {},
      metadata: {
        surface: 'care_report_pdf',
        output_profile: 'external_submission_pdf',
        report_updated_at: '2026-03-28T09:00:00.000Z',
      },
    });
    expect(bodyText).not.toContain('山田');
    expect(bodyText).not.toContain('090-1234-5678');
    expect(bodyText).not.toContain('アムロジピン');
    expect(bodyText).not.toContain('raw.pdf');
    expect(bodyText).not.toContain('signed.example');
    expect(bodyText).not.toContain('token=secret');
    expect(bodyText).not.toContain('provider raw error');
    expect(bodyText).not.toContain('処方全文');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'audit_log',
        format: 'json',
        filters: expect.objectContaining({
          targetType: 'care_report',
          action: 'export',
        }),
      }),
    );
  });

  it('preserves safe care report PDF profile fields and redacts hostile legacy metadata in csv export payloads', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockResolvedValue([legacyCareReportPdfExportAuditRow()]);

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=csv&target_type=care_report&action=export'),
      emptyRouteContext,
    )) as Response;
    const body = await response.text();

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(body).toContain('care_report_pdf');
    expect(body).toContain('external_submission_pdf');
    expect(body).toContain('2026-03-28T09:00:00.000Z');
    expect(body).not.toContain('山田');
    expect(body).not.toContain('090-1234-5678');
    expect(body).not.toContain('アムロジピン');
    expect(body).not.toContain('raw.pdf');
    expect(body).not.toContain('signed.example');
    expect(body).not.toContain('token=secret');
    expect(body).not.toContain('provider raw error');
    expect(body).not.toContain('処方全文');
  });

  it('redacts hostile file download metadata values in json export payloads', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockResolvedValue([
      {
        id: 'audit_file_download_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'file_download',
        target_type: 'file_asset',
        target_id: 'file_1',
        changes: {
          format: 'file',
          record_count: 1,
          metadata: {
            file_id: 'file_1',
            file_purpose: '患者 山田太郎 03-1234-5678',
            mime_type: 'application/pdf',
            size_bytes: 1000,
            source: 'https://signed.example/raw.pdf?token=secret',
            provider_raw_error: 'provider raw error',
          },
        },
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        created_at: new Date('2026-03-28T00:00:00.000Z'),
      },
    ]);

    const response = (await GET(
      createRequest(
        { 'x-org-id': 'org_1' },
        'format=json&target_type=file_asset&action=file_download',
      ),
      emptyRouteContext,
    )) as Response;
    const body = await response.json();
    const bodyText = JSON.stringify(body);

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(body[0].changes).toEqual({
      format: 'file',
      record_count: 1,
      filters: {},
      metadata: {
        file_id: 'file_1',
        mime_type: 'application/pdf',
        size_bytes: 1000,
      },
    });
    expect(bodyText).not.toContain('山田太郎');
    expect(bodyText).not.toContain('03-1234-5678');
    expect(bodyText).not.toContain('signed.example');
    expect(bodyText).not.toContain('token=secret');
    expect(bodyText).not.toContain('provider raw error');
  });

  it('returns no-store 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=json'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(401);
    expectNoStore(response);
  });

  it('returns no-store 403 when the role cannot export audit logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=json'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(403);
    expectNoStore(response);
  });

  it('returns no-store validation errors for invalid export formats', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=xlsx'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(400);
    expectNoStore(response);
  });

  it('returns a sanitized no-store 500 when audit export fails unexpectedly', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockRejectedValueOnce(new Error('raw patient audit export secret'));

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=json'),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw patient audit export secret');
  });

  it.each([
    ['consent_record', 'consent_record_revoked'],
    ['PatientShareCase', 'patient_share_case_activated'],
    ['PatientShareConsent', 'patient_share_consent_registered'],
    ['PatientShareConsent', 'patient_share_consent_revoked'],
    ['patient_share_consent', 'patient_share_consent.update'],
    ['PatientShareCorrectionRequest', 'patient_share_correction_requests_viewed'],
    ['PatientLink', 'patient_link_accepted'],
    ['file_asset', 'file_download'],
    ['care_report', 'care_report_print_requested'],
  ])('exports v0.2 audit vocabulary target_type=%s action=%s', async (targetType, action) => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const search = new URLSearchParams({
      format: 'json',
      target_type: targetType,
      action,
    }).toString();
    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, search),
      emptyRouteContext,
    )) as Response;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          target_type: targetType,
          action,
        }),
      }),
    );
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'audit_log',
        format: 'json',
        filters: expect.objectContaining({
          targetType,
          action,
        }),
      }),
    );
  });

  it('redacts proposal reject free text from json export payloads', async () => {
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

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=json'),
      emptyRouteContext,
    )) as Response;
    const body = await response.json();
    const bodyText = JSON.stringify(body);

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(body[0].changes).toMatchObject({
      reject_reason: '却下理由の自由記載は出力対象外です',
      reject_reason_redacted: true,
    });
    expect(bodyText).not.toContain('東京都港区2-2-2');
    expect(bodyText).not.toContain('090-1234-5678');
    expect(bodyText).not.toContain('アムロジピン');
    expect(bodyText).not.toContain('処方詳細');
  });

  it('redacts proposal reject free text from csv export payloads', async () => {
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

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=csv'),
      emptyRouteContext,
    )) as Response;
    const body = await response.text();

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(body).toContain('却下理由の自由記載は出力対象外です');
    expect(body).toContain('reject_reason_redacted');
    expect(body).not.toContain('東京都港区2-2-2');
    expect(body).not.toContain('090-1234-5678');
    expect(body).not.toContain('アムロジピン');
    expect(body).not.toContain('処方詳細');
  });

  it('redacts formulary rejected decision free text from json export payloads', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockResolvedValue([
      {
        id: 'audit_formulary_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'pharmacy_drug_stock_change_rejected',
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
            adoption_note: '旧メモ 山田太郎',
          },
          decision_note: '却下理由 患者A 090-1234-5678',
          applied_stock_id: null,
        },
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        created_at: new Date('2026-04-09T00:00:00.000Z'),
      },
    ]);

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=json'),
      emptyRouteContext,
    )) as Response;
    const body = await response.json();
    const bodyText = JSON.stringify(body);

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(body[0].changes).toMatchObject({
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
        adoption_note_present: true,
        adoption_note_length: expect.any(Number),
        adoption_note_redacted: true,
      },
      decision_note_present: true,
      decision_note_length: expect.any(Number),
      decision_note_redacted: true,
      applied_stock_id: null,
    });
    expect(body[0].changes).not.toHaveProperty('reason');
    expect(body[0].changes).not.toHaveProperty('decision_note');
    expect(body[0].changes.requested_payload).not.toHaveProperty('adoption_note');
    expect(body[0].changes.current_snapshot).not.toHaveProperty('adoption_note');
    expect(bodyText).not.toContain('患者A');
    expect(bodyText).not.toContain('090-1234-5678');
    expect(bodyText).not.toContain('山田花子');
    expect(bodyText).not.toContain('山田太郎');
    expect(bodyText).not.toContain('アムロジピン');
  });

  it('redacts formulary approved decision free text from csv export payloads', async () => {
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

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=csv'),
      emptyRouteContext,
    )) as Response;
    const body = await response.text();

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(body).toContain('adoption_note_redacted');
    expect(body).toContain('reason_redacted');
    expect(body).toContain('decision_note_redacted');
    expect(body).toContain('applied_stock_id');
    expect(body).not.toContain('患者A');
    expect(body).not.toContain('090-1234-5678');
    expect(body).not.toContain('山田花子');
    expect(body).not.toContain('山田太郎');
    expect(body).not.toContain('アムロジピン');
  });

  it('neutralizes spreadsheet formula prefixes in csv cells', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockResolvedValue([
      {
        id: '=audit_1',
        org_id: 'org_1',
        actor_id: '+user_1',
        action: '@export',
        target_type: 'visit_record',
        target_id: '-visit_1',
        changes: { note: '\tformula-like' },
        ip_address: '\r127.0.0.1',
        user_agent: '\nvitest',
        created_at: new Date('2026-03-28T00:00:00.000Z'),
      },
    ]);

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=csv'),
      emptyRouteContext,
    )) as Response;
    const body = await response.text();

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(body).toContain('"\'=audit_1"');
    expect(body).toContain('"\'+user_1"');
    expect(body).toContain('"\'@export"');
    expect(body).toContain('"\'-visit_1"');
    expect(body).toContain('"\'\r127.0.0.1"');
    expect(body).toContain('"\'\nvitest"');
    expect(body).not.toContain('"=audit_1"');
    expect(body).not.toContain('"+user_1"');
    expect(body).not.toContain('"@export"');
    expect(body).not.toContain('"-visit_1"');
  });
});
